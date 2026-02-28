// src/lib/contractorService.ts
import { supabase } from './supabase';
import { QUIZ_PASS_THRESHOLD } from './trainingModules';

// --- TYPES ---

export interface Contractor {
  id: string;
  contractorId: string;     // e.g. "H1001"
  firstName: string;
  lastName: string;
  cellPhone?: string;
  commandCenterId: string;
  region?: string;
  createdAt?: string;
}

export interface TrainingProgress {
  id: string;
  contractorId: string;
  commandCenterId: string;
  moduleId: string;
  isCompleted: boolean;
  completedAt?: string;
}

export interface TrainingAttempt {
  id: string;
  contractorId: string;
  commandCenterId: string;
  moduleId: string;
  score: number;
  totalQuestions: number;
  passed: boolean;
  attemptedAt: string;
}

// What we store in localStorage when a contractor logs into training
export interface TrainingContractor {
  contractorId: string;
  firstName: string;
  lastName: string;
  commandCenterId: string;
  region?: string;
}

// Per-worker summary for the CC admin view
export interface ContractorTrainingSummary {
  contractor: Contractor;
  progress: TrainingProgress[];
  attempts: TrainingAttempt[];
  completedCount: number;
  totalModules: number;
}

class ContractorService {
  private static instance: ContractorService;

  private constructor() {}

  public static getInstance(): ContractorService {
    if (!ContractorService.instance) {
      ContractorService.instance = new ContractorService();
    }
    return ContractorService.instance;
  }

  // -------------------------------------------------------------------
  // LOGIN
  // -------------------------------------------------------------------

  /**
   * Authenticate a contractor by contractor_id + first name (case-insensitive).
   * Used in the login flow when no active session is found.
   */
  public async authenticateContractor(
    contractorId: string,
    firstName: string
  ): Promise<Contractor | null> {
    const { data, error } = await supabase
      .from('contractors')
      .select('*')
      .eq('contractor_id', contractorId)
      .ilike('first_name', firstName.trim())
      .maybeSingle();

    if (error || !data) return null;

    return this.mapDbToContractor(data);
  }

  /**
   * Search ALL command centers for an active logsheet session for this contractor.
   * Used to implement the "road trip" rule: active logsheet always takes priority.
   * Returns the CC id where an active session exists, or null.
   */
  public async findActiveSessionAcrossAllCCs(
    contractorId: string
  ): Promise<string | null> {
    const { data, error } = await supabase
      .from('logsheet_sessions')
      .select('id, command_center_id')
      .eq('worker_id', contractorId)
      .in('status', ['OPEN', 'COMPLETE'])
      .maybeSingle();

    if (error || !data) return null;

    return data.command_center_id;
  }

  // -------------------------------------------------------------------
  // SYNC FROM GOOGLE SHEETS
  // -------------------------------------------------------------------

  /**
   * Given rows read from the Contractors/Workerbook tab,
   * upsert new contractors into Supabase for this CC.
   * Returns counts of { added, skipped }.
   *
   * Expected row format (0-indexed columns):
   *   col 1 = CN# (contractor_id)
   *   col 2 = First Name
   *   col 3 = Last Name
   *   col 4 = Cell Phone
   *
   * Rows with no contractor_id are skipped.
   * Existing contractor_ids (per CC) are skipped (no overwrite).
   */
  public async syncContractorsFromRows(
    rows: any[][],
    commandCenterId: string,
    region?: string
  ): Promise<{ added: number; skipped: number }> {
    let added = 0;
    let skipped = 0;

    const records: any[] = [];

    for (const row of rows) {
      const contractorId = row[1]?.toString().trim();
      const firstName = row[2]?.toString().trim();
      const lastName = row[3]?.toString().trim();
      const cellPhone = row[4]?.toString().trim() || null;

      if (!contractorId || !firstName) {
        skipped++;
        continue;
      }

      records.push({
        contractor_id: contractorId,
        first_name: firstName,
        last_name: lastName || '',
        cell_phone: cellPhone,
        command_center_id: commandCenterId,
        region: region || null,
      });
    }

    if (records.length === 0) return { added: 0, skipped };

    // Upsert — on conflict (contractor_id, command_center_id) do nothing
    const { data, error } = await supabase
      .from('contractors')
      .upsert(records, {
        onConflict: 'contractor_id,command_center_id',
        ignoreDuplicates: true,
      })
      .select();

    if (error) throw new Error(error.message);

    added = data?.length ?? 0;
    skipped += records.length - added;

    return { added, skipped };
  }

  // -------------------------------------------------------------------
  // FETCH FOR ADMIN VIEW
  // -------------------------------------------------------------------

  /**
   * Get all contractors for a command center.
   */
  public async getContractorsForCC(commandCenterId: string): Promise<Contractor[]> {
    const { data, error } = await supabase
      .from('contractors')
      .select('*')
      .eq('command_center_id', commandCenterId)
      .order('last_name', { ascending: true });

    if (error) throw new Error(error.message);
    return (data || []).map(this.mapDbToContractor);
  }

  /**
   * Get full training summary for all contractors in a CC.
   * Used by the Trainings admin tab.
   */
  public async getTrainingSummaryForCC(
    commandCenterId: string,
    totalModules: number
  ): Promise<ContractorTrainingSummary[]> {
    const contractors = await this.getContractorsForCC(commandCenterId);
    if (contractors.length === 0) return [];

    const contractorIds = contractors.map((c) => c.contractorId);

    // Fetch all progress records for this CC
    const { data: progressData, error: progressError } = await supabase
      .from('training_progress')
      .select('*')
      .eq('command_center_id', commandCenterId)
      .in('contractor_id', contractorIds);

    if (progressError) throw new Error(progressError.message);

    // Fetch all attempts for this CC
    const { data: attemptsData, error: attemptsError } = await supabase
      .from('training_attempts')
      .select('*')
      .eq('command_center_id', commandCenterId)
      .in('contractor_id', contractorIds)
      .order('attempted_at', { ascending: false });

    if (attemptsError) throw new Error(attemptsError.message);

    const progressMap = new Map<string, TrainingProgress[]>();
    const attemptsMap = new Map<string, TrainingAttempt[]>();

    (progressData || []).forEach((p) => {
      const mapped = this.mapDbToProgress(p);
      if (!progressMap.has(mapped.contractorId)) progressMap.set(mapped.contractorId, []);
      progressMap.get(mapped.contractorId)!.push(mapped);
    });

    (attemptsData || []).forEach((a) => {
      const mapped = this.mapDbToAttempt(a);
      if (!attemptsMap.has(mapped.contractorId)) attemptsMap.set(mapped.contractorId, []);
      attemptsMap.get(mapped.contractorId)!.push(mapped);
    });

    return contractors.map((c) => {
      const progress = progressMap.get(c.contractorId) || [];
      const attempts = attemptsMap.get(c.contractorId) || [];
      const completedCount = progress.filter((p) => p.isCompleted).length;

      return { contractor: c, progress, attempts, completedCount, totalModules };
    });
  }

  // -------------------------------------------------------------------
  // DELETE CONTRACTOR
  // -------------------------------------------------------------------

  /**
   * Delete a contractor and all their training data (progress + attempts).
   * Uses the row UUID (id), not contractor_id, to be precise.
   */
  public async deleteContractor(id: string, commandCenterId: string): Promise<void> {
    // First fetch the contractor_id so we can delete related records
    const { data: contractor, error: fetchError } = await supabase
      .from('contractors')
      .select('contractor_id')
      .eq('id', id)
      .eq('command_center_id', commandCenterId)
      .single();

    if (fetchError || !contractor) {
      throw new Error('Contractor not found');
    }

    const contractorId = contractor.contractor_id;

    // Delete all quiz attempts for this contractor in this CC
    const { error: attemptsError } = await supabase
      .from('training_attempts')
      .delete()
      .eq('contractor_id', contractorId)
      .eq('command_center_id', commandCenterId);

    if (attemptsError) throw new Error(attemptsError.message);

    // Delete all training progress for this contractor in this CC
    const { error: progressError } = await supabase
      .from('training_progress')
      .delete()
      .eq('contractor_id', contractorId)
      .eq('command_center_id', commandCenterId);

    if (progressError) throw new Error(progressError.message);

    // Delete the contractor record itself
    const { error: deleteError } = await supabase
      .from('contractors')
      .delete()
      .eq('id', id)
      .eq('command_center_id', commandCenterId);

    if (deleteError) throw new Error(deleteError.message);
  }

  // -------------------------------------------------------------------
  // TRAINING PROGRESS (worker-facing)
  // -------------------------------------------------------------------

  /**
   * Get all progress records for a contractor.
   */
  public async getProgressForContractor(
    contractorId: string
  ): Promise<TrainingProgress[]> {
    const { data, error } = await supabase
      .from('training_progress')
      .select('*')
      .eq('contractor_id', contractorId);

    if (error) throw new Error(error.message);
    return (data || []).map(this.mapDbToProgress);
  }

  /**
   * Get all quiz attempts for a contractor (most recent first).
   */
  public async getAttemptsForContractor(
    contractorId: string
  ): Promise<TrainingAttempt[]> {
    const { data, error } = await supabase
      .from('training_attempts')
      .select('*')
      .eq('contractor_id', contractorId)
      .order('attempted_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data || []).map(this.mapDbToAttempt);
  }

  /**
   * Submit a quiz attempt. Automatically marks the module as complete if passed.
   * Returns the saved attempt.
   */
  public async submitQuizAttempt(
    contractorId: string,
    commandCenterId: string,
    moduleId: string,
    score: number,
    totalQuestions: number
  ): Promise<TrainingAttempt> {
    const passed = score / totalQuestions >= QUIZ_PASS_THRESHOLD;

    // Save the attempt
    const { data: attemptData, error: attemptError } = await supabase
      .from('training_attempts')
      .insert({
        contractor_id: contractorId,
        command_center_id: commandCenterId,
        module_id: moduleId,
        score,
        total_questions: totalQuestions,
        passed,
      })
      .select()
      .single();

    if (attemptError) throw new Error(attemptError.message);

    // If passed, upsert progress as completed
    if (passed) {
      await supabase.from('training_progress').upsert(
        {
          contractor_id: contractorId,
          command_center_id: commandCenterId,
          module_id: moduleId,
          is_completed: true,
          completed_at: new Date().toISOString(),
        },
        { onConflict: 'contractor_id,module_id' }
      );
    } else {
      // Ensure a progress record exists even if not yet passed
      await supabase.from('training_progress').upsert(
        {
          contractor_id: contractorId,
          command_center_id: commandCenterId,
          module_id: moduleId,
          is_completed: false,
        },
        { onConflict: 'contractor_id,module_id', ignoreDuplicates: true }
      );
    }

    return this.mapDbToAttempt(attemptData);
  }

  // -------------------------------------------------------------------
  // LOCAL STORAGE HELPERS
  // -------------------------------------------------------------------

  public setCurrentTrainingContractor(contractor: TrainingContractor): void {
    localStorage.setItem('training_contractor', JSON.stringify(contractor));
  }

  public getCurrentTrainingContractor(): TrainingContractor | null {
    const raw = localStorage.getItem('training_contractor');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  public clearCurrentTrainingContractor(): void {
    localStorage.removeItem('training_contractor');
  }

  // -------------------------------------------------------------------
  // MAPPERS
  // -------------------------------------------------------------------

  private mapDbToContractor(data: any): Contractor {
    return {
      id: data.id,
      contractorId: data.contractor_id,
      firstName: data.first_name,
      lastName: data.last_name,
      cellPhone: data.cell_phone,
      commandCenterId: data.command_center_id,
      region: data.region,
      createdAt: data.created_at,
    };
  }

  private mapDbToProgress(data: any): TrainingProgress {
    return {
      id: data.id,
      contractorId: data.contractor_id,
      commandCenterId: data.command_center_id,
      moduleId: data.module_id,
      isCompleted: data.is_completed,
      completedAt: data.completed_at,
    };
  }

  private mapDbToAttempt(data: any): TrainingAttempt {
    return {
      id: data.id,
      contractorId: data.contractor_id,
      commandCenterId: data.command_center_id,
      moduleId: data.module_id,
      score: data.score,
      totalQuestions: data.total_questions,
      passed: data.passed,
      attemptedAt: data.attempted_at,
    };
  }
}

export const contractorService = ContractorService.getInstance();