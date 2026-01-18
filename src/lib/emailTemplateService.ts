// src/lib/emailTemplateService.ts
import { supabase } from './supabase';
import { commandCenterService } from './commandCenterService';
import { 
  EmailTemplate, 
  EmailTemplateType, 
  EmailTemplateTypeInfo,
  EmailTemplateStructure,
  Region 
} from '../types';

// --- LOGO URL (Hardcoded) ---
const LOGO_URL = 'https://mipvcafqrmwxnoqmicxh.supabase.co/storage/v1/object/public/logos/logo-white.png';

// --- TEMPLATE TYPE DEFINITIONS ---
export const EMAIL_TEMPLATE_TYPES: EmailTemplateTypeInfo[] = [
  // General (all regions)
  { type: 'production', name: 'Production Receipt', category: 'general', description: 'Sent when a prebook is completed with payment' },
  { type: 'sale', name: 'New Sale', category: 'general', description: 'Sent when a new customer sale is made' },
  { type: 'billed', name: 'Billed / Invoice', category: 'general', description: 'Sent when payment method is Billed or IOS' },
  { type: 'prepaid', name: 'Prepaid Confirmation', category: 'general', description: 'Sent when a prepaid customer service is completed' },
  
  // West Upgrades
  { type: 'upgrade_star_plan_pro', name: 'Star Plan Pro', category: 'upgrade', description: 'Star Plan Pro upgrade confirmation', region: 'West' },
  { type: 'upgrade_lawn_rejuv', name: 'Lawn Rejuvenation', category: 'upgrade', description: 'Lawn Rejuvenation upgrade confirmation', region: 'West' },
  { type: 'upgrade_golf_course', name: 'Golf Course', category: 'upgrade', description: 'Golf Course package confirmation', region: 'West' },
  
  // West Add-Ons
  { type: 'addon_dethatch', name: 'Dethatching', category: 'addon', description: 'Dethatching add-on confirmation', region: 'West' },
  { type: 'addon_rejuv_after_care', name: 'Rejuvenation After Care', category: 'addon', description: 'Rejuv After Care add-on confirmation', region: 'West' },
  { type: 'addon_grub', name: 'Grub Control', category: 'addon', description: 'Grub Control add-on confirmation', region: 'West' },
  
  // Central Add-Ons
  { type: 'addon_window_washing', name: 'Window Washing', category: 'addon', description: 'Window Washing add-on confirmation', region: 'Central' },
  
  // East Add-Ons
  { type: 'addon_driveway_sealing', name: 'Driveway Sealing', category: 'addon', description: 'Driveway Sealing add-on confirmation', region: 'East' },
  { type: 'addon_hot_asphalt', name: 'Hot Asphalt', category: 'addon', description: 'Hot Asphalt add-on confirmation', region: 'East' },
];

// --- DEFAULT TEMPLATE SUBJECTS ---
export const DEFAULT_SUBJECTS: Record<EmailTemplateType, string> = {
  production: 'Your Service Receipt - Property Stars',
  sale: 'Welcome to Property Stars!',
  billed: 'Your Service Invoice - Property Stars',
  prepaid: 'Service Completed - Thank You!',
  upgrade_star_plan_pro: 'Your Star Plan Pro Confirmation',
  upgrade_lawn_rejuv: 'Your Lawn Rejuvenation Confirmation',
  upgrade_golf_course: 'Your Golf Course Package Confirmation',
  addon_dethatch: 'Your Dethatching Service Confirmation',
  addon_rejuv_after_care: 'Your Rejuvenation After Care Confirmation',
  addon_grub: 'Your Grub Control Confirmation',
  addon_window_washing: 'Your Window Washing Service Confirmation',
  addon_driveway_sealing: 'Your Driveway Sealing Service Confirmation',
  addon_hot_asphalt: 'Your Hot Asphalt Service Confirmation',
};

// --- AVAILABLE TEMPLATE VARIABLES ---
export const TEMPLATE_VARIABLES = [
  { key: 'firstName', label: 'First Name', example: 'John' },
  { key: 'lastName', label: 'Last Name', example: 'Smith' },
  { key: 'fullName', label: 'Full Name', example: 'John Smith' },
  { key: 'address', label: 'Address', example: '123 Main Street' },
  { key: 'price', label: 'Price (raw)', example: '125.00' },
  { key: 'displayPrice', label: 'Display Price', example: '$125.00' },
  { key: 'paymentMethod', label: 'Payment Method', example: 'Credit Card' },
  { key: 'date', label: 'Service Date', example: 'January 17, 2026' },
  { key: 'serviceName', label: 'Service Name', example: 'Lawn Aeration' },
  { key: 'workerName', label: 'Worker Name', example: 'Mike' },
  { key: 'companyName', label: 'Company Name', example: 'Property Stars West' },
];

// --- DEFAULT HTML TEMPLATE ---
export const getDefaultTemplateHtml = (templateType: EmailTemplateType, companyName: string = 'Property Stars'): string => {
  const isUpgrade = templateType.startsWith('upgrade_');
  const isAddon = templateType.startsWith('addon_');
  const isBilled = templateType === 'billed';
  const isPrepaid = templateType === 'prepaid';
  
  let mainMessage = 'Thank you for choosing Property Stars! Your service has been completed.';
  let paymentSection = `
    <tr>
      <td style="padding: 20px 30px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0fdf4; border-radius: 8px; padding: 20px;">
          <tr>
            <td style="font-size: 14px; color: #166534;">
              <strong>Amount Paid:</strong> {{displayPrice}}<br/>
              <strong>Payment Method:</strong> {{paymentMethod}}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
  
  if (isBilled) {
    mainMessage = 'Thank you for your service! Please find your invoice details below.';
    paymentSection = `
    <tr>
      <td style="padding: 20px 30px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #fef3c7; border-radius: 8px; padding: 20px;">
          <tr>
            <td style="font-size: 14px; color: #92400e;">
              <strong>Amount Due:</strong> {{displayPrice}}<br/>
              <strong>Payment Status:</strong> Invoice Sent
            </td>
          </tr>
        </table>
      </td>
    </tr>
    `;
  } else if (isPrepaid) {
    mainMessage = 'Your prepaid service has been completed. Thank you for being a valued customer!';
    paymentSection = `
    <tr>
      <td style="padding: 20px 30px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #dbeafe; border-radius: 8px; padding: 20px;">
          <tr>
            <td style="font-size: 14px; color: #1e40af;">
              <strong>Service Value:</strong> {{displayPrice}}<br/>
              <strong>Status:</strong> Prepaid - No Payment Required
            </td>
          </tr>
        </table>
      </td>
    </tr>
    `;
  } else if (isUpgrade) {
    mainMessage = 'Congratulations on upgrading your lawn care! Your upgrade has been confirmed.';
  } else if (isAddon) {
    mainMessage = 'Your add-on service has been confirmed. We appreciate your continued trust in Property Stars!';
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header with Logo -->
          <tr>
            <td style="background: linear-gradient(135deg, #1f2937 0%, #374151 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
              <img src="${LOGO_URL}" alt="{{companyName}}" style="max-width: 200px; height: auto;" />
            </td>
          </tr>
          
          <!-- Greeting -->
          <tr>
            <td style="padding: 30px 30px 10px 30px;">
              <h2 style="margin: 0 0 10px 0; color: #1f2937; font-size: 20px;">Hi {{firstName}},</h2>
              <p style="margin: 0; color: #4b5563; font-size: 16px; line-height: 1.6;">
                ${mainMessage}
              </p>
            </td>
          </tr>
          
          <!-- Service Details -->
          <tr>
            <td style="padding: 20px 30px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; border-radius: 8px; padding: 20px;">
                <tr>
                  <td style="font-size: 14px; color: #374151;">
                    <strong>Service:</strong> {{serviceName}}<br/>
                    <strong>Address:</strong> {{address}}<br/>
                    <strong>Date:</strong> {{date}}<br/>
                    <strong>Technician:</strong> {{workerName}}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Payment Details -->
          ${paymentSection}
          
          <!-- Footer -->
          <tr>
            <td style="padding: 30px; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px;">
                Questions? Simply reply to this email and we'll be happy to help.
              </p>
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                © 2026 {{companyName}}. All rights reserved.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
};

// --- HELPER: Get CC ID with error handling ---
const getCCId = (): string => {
  const ccId = commandCenterService.getCurrentCommandCenterId();
  if (!ccId) {
    throw new Error('No command center context. Please log in first.');
  }
  return ccId;
};

// --- SERVICE CLASS ---
class EmailTemplateService {
  private static instance: EmailTemplateService;
  
  private constructor() {}
  
  public static getInstance(): EmailTemplateService {
    if (!EmailTemplateService.instance) {
      EmailTemplateService.instance = new EmailTemplateService();
    }
    return EmailTemplateService.instance;
  }

  // --- GET TEMPLATE TYPES FOR REGION ---
  public getTemplateTypesForRegion(region: Region): EmailTemplateTypeInfo[] {
    return EMAIL_TEMPLATE_TYPES.filter(t => 
      !t.region || t.region === region
    );
  }

  // --- GET ALL TEMPLATES FOR CURRENT CC ---
  public async getTemplates(): Promise<EmailTemplate[]> {
    const ccId = getCCId();
    
    const { data, error } = await supabase
      .from('email_templates')
      .select('*')
      .eq('command_center_id', ccId)
      .order('template_type');
    
    if (error) throw error;
    
    return (data || []).map(this.mapDbToTemplate);
  }

  // --- GET SINGLE TEMPLATE BY TYPE ---
  public async getTemplateByType(templateType: EmailTemplateType): Promise<EmailTemplate | null> {
    const ccId = getCCId();
    
    const { data, error } = await supabase
      .from('email_templates')
      .select('*')
      .eq('command_center_id', ccId)
      .eq('template_type', templateType)
      .maybeSingle();
    
    if (error) throw error;
    if (!data) return null;
    
    return this.mapDbToTemplate(data);
  }

  // --- GET TEMPLATE BY ID ---
  public async getTemplateById(id: string): Promise<EmailTemplate | null> {
    const ccId = getCCId();
    
    const { data, error } = await supabase
      .from('email_templates')
      .select('*')
      .eq('id', id)
      .eq('command_center_id', ccId)
      .maybeSingle();
    
    if (error) throw error;
    if (!data) return null;
    
    return this.mapDbToTemplate(data);
  }

  // --- CREATE OR UPDATE TEMPLATE ---
  public async saveTemplate(template: Partial<EmailTemplate> & { templateType: EmailTemplateType }): Promise<EmailTemplate> {
    const ccId = getCCId();
    const cc = commandCenterService.getCurrentCommandCenter();
    
    // Check if template exists
    const existing = await this.getTemplateByType(template.templateType);
    
    const templateData = {
      command_center_id: ccId,
      template_type: template.templateType,
      template_name: template.templateName || this.getTemplateTypeInfo(template.templateType)?.name || template.templateType,
      subject: template.subject || DEFAULT_SUBJECTS[template.templateType],
      html_content: template.htmlContent || getDefaultTemplateHtml(template.templateType, cc?.displayName),
      is_active: template.isActive ?? true,
      updated_at: new Date().toISOString(),
    };
    
    if (existing) {
      // Update
      const { data, error } = await supabase
        .from('email_templates')
        .update(templateData)
        .eq('id', existing.id)
        .select()
        .single();
      
      if (error) throw error;
      return this.mapDbToTemplate(data);
    } else {
      // Insert
      const { data, error } = await supabase
        .from('email_templates')
        .insert(templateData)
        .select()
        .single();
      
      if (error) throw error;
      return this.mapDbToTemplate(data);
    }
  }

  // --- DELETE TEMPLATE ---
  public async deleteTemplate(id: string): Promise<void> {
    const ccId = getCCId();
    
    const { error } = await supabase
      .from('email_templates')
      .delete()
      .eq('id', id)
      .eq('command_center_id', ccId);
    
    if (error) throw error;
  }

  // --- TOGGLE TEMPLATE ACTIVE STATUS ---
  public async toggleTemplateActive(id: string, isActive: boolean): Promise<void> {
    const ccId = getCCId();
    
    const { error } = await supabase
      .from('email_templates')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('command_center_id', ccId);
    
    if (error) throw error;
  }

  // --- INITIALIZE DEFAULT TEMPLATES ---
  public async initializeDefaultTemplates(): Promise<number> {
    const ccId = getCCId();
    const cc = commandCenterService.getCurrentCommandCenter();
    if (!cc) throw new Error('No command center context');
    
    const existingTemplates = await this.getTemplates();
    const existingTypes = new Set(existingTemplates.map(t => t.templateType));
    
    const typesForRegion = this.getTemplateTypesForRegion(cc.region);
    const templatesToCreate = typesForRegion.filter(t => !existingTypes.has(t.type));
    
    if (templatesToCreate.length === 0) return 0;
    
    const inserts = templatesToCreate.map(t => ({
      command_center_id: ccId,
      template_type: t.type,
      template_name: t.name,
      subject: DEFAULT_SUBJECTS[t.type],
      html_content: getDefaultTemplateHtml(t.type, cc.displayName),
      is_active: true,
    }));
    
    const { error } = await supabase
      .from('email_templates')
      .insert(inserts);
    
    if (error) throw error;
    
    return templatesToCreate.length;
  }

  // --- REPLACE TEMPLATE VARIABLES ---
  public replaceVariables(html: string, data: Record<string, string>): string {
    let result = html;
    
    for (const [key, value] of Object.entries(data)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      result = result.replace(regex, value || '');
    }
    
    return result;
  }

  // --- GET TEMPLATE TYPE INFO ---
  public getTemplateTypeInfo(type: EmailTemplateType): EmailTemplateTypeInfo | undefined {
    return EMAIL_TEMPLATE_TYPES.find(t => t.type === type);
  }

  // --- DETERMINE TEMPLATE TYPE FROM TRANSACTION ---
  public determineTemplateType(transaction: {
    type: string;
    paymentMethod: string;
    isPrepaid?: boolean;
    refId?: string;
  }): EmailTemplateType {
    const { type, paymentMethod, isPrepaid, refId } = transaction;
    
    // Check for billed/IOS first
    if (paymentMethod === 'Billed' || paymentMethod === 'IOS') {
      return 'billed';
    }
    
    // Check for prepaid
    if (isPrepaid || paymentMethod === 'Prepaid') {
      return 'prepaid';
    }
    
    // Check for upgrade types (West only)
    if (type === 'Upgrade') {
      if (refId === 'star_plan_pro') return 'upgrade_star_plan_pro';
      if (refId === 'lawn_rejuv') return 'upgrade_lawn_rejuv';
      if (refId === 'golf_course') return 'upgrade_golf_course';
      // Default to production if unknown upgrade
      return 'production';
    }
    
    // Check for add-on types
    if (type === 'Add-On') {
      // West add-ons
      if (refId === 'dethatch') return 'addon_dethatch';
      if (refId === 'rejuv_after_care') return 'addon_rejuv_after_care';
      if (refId === 'grub') return 'addon_grub';
      // Central add-ons
      if (refId === 'window_washing') return 'addon_window_washing';
      // East add-ons
      if (refId === 'driveway_sealing') return 'addon_driveway_sealing';
      if (refId === 'hot_asphalt') return 'addon_hot_asphalt';
      // Default to production if unknown add-on
      return 'production';
    }
    
    // Check for new sale
    if (type === 'Sale') {
      return 'sale';
    }
    
    // Default to production
    return 'production';
  }

  // --- PREVIEW TEMPLATE WITH SAMPLE DATA ---
  public getPreviewHtml(htmlContent: string, companyName: string = 'Property Stars'): string {
    const sampleData: Record<string, string> = {
      firstName: 'John',
      lastName: 'Smith',
      fullName: 'John Smith',
      address: '123 Main Street',
      price: '125.00',
      displayPrice: '$125.00',
      paymentMethod: 'Credit Card',
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      serviceName: 'Lawn Aeration',
      workerName: 'Mike',
      companyName: companyName,
    };
    
    return this.replaceVariables(htmlContent, sampleData);
  }

  // --- HELPER: Map DB row to EmailTemplate ---
  private mapDbToTemplate(data: any): EmailTemplate {
    return {
      id: data.id,
      commandCenterId: data.command_center_id,
      templateType: data.template_type as EmailTemplateType,
      templateName: data.template_name,
      subject: data.subject,
      htmlContent: data.html_content,
      isActive: data.is_active,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
}

export const emailTemplateService = EmailTemplateService.getInstance();