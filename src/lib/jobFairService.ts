// src/lib/jobFairService.ts
import { supabase } from './supabase';
import { commandCenterService } from './commandCenterService';
import { 
  JobFairSession, 
  JobFairApplicant, 
  ApplicantFormData,
  ApplicantIdType 
} from '../types';

class JobFairService {
  private static instance: JobFairService;

  private constructor() {}

  public static getInstance(): JobFairService {
    if (!JobFairService.instance) {
      JobFairService.instance = new JobFairService();
    }
    return JobFairService.instance;
  }

  // --- HELPER: Get current CC ID ---
  private getCCId(): string {
    const ccId = commandCenterService.getCurrentCommandCenterId();
    if (!ccId) {
      throw new Error('No command center context');
    }
    return ccId;
  }

  // --- SESSION MANAGEMENT ---

  /**
   * Get the active job fair session for the current command center
   */
  public async getActiveSession(): Promise<JobFairSession | null> {
    const ccId = this.getCCId();

    const { data, error } = await supabase
      .from('job_fair_sessions')
      .select('*')
      .eq('command_center_id', ccId)
      .eq('status', 'active')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;

    return this.mapDbToSession(data);
  }

  /**
   * Get the active session for a specific command center (for public form)
   */
  public async getActiveSessionByCommandCenterId(ccId: string): Promise<JobFairSession | null> {
    const { data, error } = await supabase
      .from('job_fair_sessions')
      .select('*')
      .eq('command_center_id', ccId)
      .eq('status', 'active')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;

    return this.mapDbToSession(data);
  }

  /**
   * Initialize a new job fair session
   */
  public async initializeSession(): Promise<JobFairSession> {
    const ccId = this.getCCId();

    // Check if there's already an active session
    const existing = await this.getActiveSession();
    if (existing) {
      throw new Error('There is already an active job fair session. Close it first.');
    }

    const { data, error } = await supabase
      .from('job_fair_sessions')
      .insert({
        command_center_id: ccId,
        session_date: new Date().toISOString().split('T')[0],
        status: 'active',
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return this.mapDbToSession(data);
  }

  /**
   * Close the active job fair session
   * This DELETES all applicants and the session itself (data should be exported first)
   */
  public async closeSession(sessionId: string): Promise<void> {
    const ccId = this.getCCId();

    // First, delete all applicants for this session
    const { error: applicantsError } = await supabase
      .from('job_fair_applicants')
      .delete()
      .eq('session_id', sessionId);

    if (applicantsError) {
      throw new Error(`Failed to delete applicants: ${applicantsError.message}`);
    }

    // Then, delete all sessions for this command center (cleans up any orphaned/closed sessions too)
    const { error: sessionsError } = await supabase
      .from('job_fair_sessions')
      .delete()
      .eq('command_center_id', ccId);

    if (sessionsError) {
      throw new Error(`Failed to delete session: ${sessionsError.message}`);
    }
  }

  // --- APPLICANT MANAGEMENT ---

  /**
   * Get all applicants for a session, sorted by last name
   */
  public async getApplicantsBySession(sessionId: string): Promise<JobFairApplicant[]> {
    const { data, error } = await supabase
      .from('job_fair_applicants')
      .select('*')
      .eq('session_id', sessionId)
      .order('last_name', { ascending: true })
      .order('first_name', { ascending: true });

    if (error) throw new Error(error.message);

    return (data || []).map(this.mapDbToApplicant);
  }

  /**
   * Submit a new applicant (public form)
   */
  public async submitApplicant(
    sessionId: string,
    commandCenterId: string,
    formData: ApplicantFormData
  ): Promise<JobFairApplicant> {
    const { data, error } = await supabase
      .from('job_fair_applicants')
      .insert({
        session_id: sessionId,
        command_center_id: commandCenterId,
        first_name: formData.firstName.trim(),
        last_name: formData.lastName.trim(),
        cell_phone: formData.cellPhone.trim(),
        alternate_phone: formData.alternatePhone?.trim() || null,
        email: formData.email?.trim() || null,
        address: formData.address.trim(),
        city: formData.city?.trim() || null,
        postal_code: formData.postalCode?.trim() || null,
        age: formData.age,
        id_type: formData.idType,
        id_value: formData.idValue.trim(),
        rating: null,
        is_bc: false,
        is_management: false,
        is_interviewed: false,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return this.mapDbToApplicant(data);
  }

  /**
   * Update an applicant's interview data
   */
  public async updateApplicant(
    applicantId: string,
    updates: Partial<{
      rating: number | null;
      isBc: boolean;
      isManagement: boolean;
      isInterviewed: boolean;
    }>
  ): Promise<JobFairApplicant> {
    const dbUpdates: any = {};
    
    if (updates.rating !== undefined) dbUpdates.rating = updates.rating;
    if (updates.isBc !== undefined) dbUpdates.is_bc = updates.isBc;
    if (updates.isManagement !== undefined) dbUpdates.is_management = updates.isManagement;
    if (updates.isInterviewed !== undefined) dbUpdates.is_interviewed = updates.isInterviewed;

    const { data, error } = await supabase
      .from('job_fair_applicants')
      .update(dbUpdates)
      .eq('id', applicantId)
      .select()
      .single();

    if (error) throw new Error(error.message);

    return this.mapDbToApplicant(data);
  }

  /**
   * Get applicant count for a session
   */
  public async getApplicantCount(sessionId: string): Promise<number> {
    const { count, error } = await supabase
      .from('job_fair_applicants')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId);

    if (error) throw new Error(error.message);

    return count || 0;
  }

  // --- EXPORT DATA ---

  /**
   * Get all applicants formatted for Google Sheets export
   * Returns data in the order expected by the Applicants tab
   */
  public async getApplicantsForExport(sessionId: string): Promise<any[][]> {
    const applicants = await this.getApplicantsBySession(sessionId);
    const session = await this.getSessionById(sessionId);
    
    if (!session) {
      throw new Error('Session not found');
    }

    // Format for Applicants tab columns:
    // A: Shuttle (blank)
    // B: CN # (blank)
    // C: First Name
    // D: Last Name
    // E: Cell Phone
    // F: Next Day (blank)
    // G: Status (blank)
    // H: Alt. Phone
    // I: Email Address
    // J: Notes (BC/Management)
    // K: Address
    // L: City
    // M: Postal Code
    // N: JF Date
    // O: Age
    // P: SIN #
    // Q: DL #
    // R: Health Card #
    // S: Passport #
    // T: Rating

    return applicants.map(a => {
      // Build notes from BC/Management flags
      const notes: string[] = [];
      if (a.isBc) notes.push('BC');
      if (a.isManagement) notes.push('Management');

      return [
        '', // A: Shuttle
        '', // B: CN #
        a.firstName, // C: First Name
        a.lastName, // D: Last Name
        a.cellPhone, // E: Cell Phone
        '', // F: Next Day
        '', // G: Status
        a.alternatePhone || '', // H: Alt. Phone
        a.email || '', // I: Email Address
        notes.join(', '), // J: Notes
        a.address || '', // K: Address
        a.city || '', // L: City
        a.postalCode || '', // M: Postal Code
        session.sessionDate, // N: JF Date
        a.age, // O: Age
        a.idType === 'SIN' ? a.idValue : '', // P: SIN #
        a.idType === 'DL' ? a.idValue : '', // Q: DL #
        a.idType === 'HEALTH_CARD' ? a.idValue : '', // R: Health Card #
        a.idType === 'PASSPORT' ? a.idValue : '', // S: Passport #
        a.rating || '', // T: Rating
      ];
    });
  }

  /**
   * Get a session by ID
   */
  public async getSessionById(sessionId: string): Promise<JobFairSession | null> {
    const { data, error } = await supabase
      .from('job_fair_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;

    return this.mapDbToSession(data);
  }

  // --- MAPPERS ---

  private mapDbToSession(data: any): JobFairSession {
    return {
      id: data.id,
      commandCenterId: data.command_center_id,
      sessionDate: data.session_date,
      status: data.status,
      createdAt: data.created_at,
      closedAt: data.closed_at,
    };
  }

  private mapDbToApplicant(data: any): JobFairApplicant {
    return {
      id: data.id,
      sessionId: data.session_id,
      commandCenterId: data.command_center_id,
      firstName: data.first_name,
      lastName: data.last_name,
      cellPhone: data.cell_phone,
      alternatePhone: data.alternate_phone,
      email: data.email,
      address: data.address,
      city: data.city,
      postalCode: data.postal_code,
      age: data.age,
      idType: data.id_type as ApplicantIdType,
      idValue: data.id_value,
      rating: data.rating,
      isBc: data.is_bc || false,
      isManagement: data.is_management || false,
      isInterviewed: data.is_interviewed || false,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
}

export const jobFairService = JobFairService.getInstance();