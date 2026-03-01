// src/lib/onboardingService.ts
import { supabase } from './supabase';
import { commandCenterService } from './commandCenterService';

// --- LOGO ---
const LOGO_URL = 'https://mipvcafqrmwxnoqmicxh.supabase.co/storage/v1/object/public/logos/logo-white.png';

// --- TYPES ---

export interface ShuttlePoint {
  id: string;
  commandCenterId: string;
  shuttleNumber: string;
  description: string;
  pickupTime: string;
  googleMapsUrl: string;
  createdAt?: string;
}

export interface OnboardingConfig {
  id: string;
  commandCenterId: string;
  replyToEmail: string;
  facebookGroupUrl: string;
  facebookPageUrl: string;
  instagramUrl: string;
  instagramHandle: string;
  signatureName: string;
  signatureTitle: string;
  signaturePhone: string;
  signatureEmail: string;
  updatedAt?: string;
}

export interface OnboardingEmailData {
  contractorId: string;       // CN# e.g. "H1001"
  firstName: string;
  lastName: string;
  email: string;
  shuttle?: string;           // shuttle number
  firstDayBooked?: string;    // e.g. "Mar26" or null
  commandCenterId: string;
  commandCenterName: string;
}

export interface Level2UnlockEmailData {
  contractorId: string;       // CN# e.g. "H1001"
  firstName: string;
  lastName: string;
  email: string;
  commandCenterId: string;
  commandCenterName: string;
}

// --- HELPER ---
const getCCId = (): string => {
  const ccId = commandCenterService.getCurrentCommandCenterId();
  if (!ccId) throw new Error('No command center context. Please log in first.');
  return ccId;
};

// --- SERVICE ---

class OnboardingService {
  private static instance: OnboardingService;
  private constructor() {}

  public static getInstance(): OnboardingService {
    if (!OnboardingService.instance) {
      OnboardingService.instance = new OnboardingService();
    }
    return OnboardingService.instance;
  }

  // ---------------------------------------------------------------
  // SHUTTLE POINTS
  // ---------------------------------------------------------------

  public async getShuttlePoints(): Promise<ShuttlePoint[]> {
    const ccId = getCCId();
    const { data, error } = await supabase
      .from('shuttle_points')
      .select('*')
      .eq('command_center_id', ccId)
      .order('shuttle_number', { ascending: true });

    if (error) throw new Error(error.message);
    return (data || []).map(this.mapDbToShuttlePoint);
  }

  public async getShuttlePointByNumber(shuttleNumber: string): Promise<ShuttlePoint | null> {
    const ccId = getCCId();
    const { data, error } = await supabase
      .from('shuttle_points')
      .select('*')
      .eq('command_center_id', ccId)
      .eq('shuttle_number', shuttleNumber)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;
    return this.mapDbToShuttlePoint(data);
  }

  public async saveShuttlePoint(point: Omit<ShuttlePoint, 'id' | 'commandCenterId' | 'createdAt'>): Promise<ShuttlePoint> {
    const ccId = getCCId();

    const { data, error } = await supabase
      .from('shuttle_points')
      .upsert(
        {
          command_center_id: ccId,
          shuttle_number: point.shuttleNumber,
          description: point.description,
          pickup_time: point.pickupTime,
          google_maps_url: point.googleMapsUrl,
        },
        { onConflict: 'command_center_id,shuttle_number' }
      )
      .select()
      .single();

    if (error) throw new Error(error.message);
    return this.mapDbToShuttlePoint(data);
  }

  public async deleteShuttlePoint(id: string): Promise<void> {
    const ccId = getCCId();
    const { error } = await supabase
      .from('shuttle_points')
      .delete()
      .eq('id', id)
      .eq('command_center_id', ccId);

    if (error) throw new Error(error.message);
  }

  // ---------------------------------------------------------------
  // ONBOARDING CONFIG
  // ---------------------------------------------------------------

  public async getConfig(): Promise<OnboardingConfig | null> {
    const ccId = getCCId();
    const { data, error } = await supabase
      .from('onboarding_config')
      .select('*')
      .eq('command_center_id', ccId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;
    return this.mapDbToConfig(data);
  }

  public async saveConfig(config: Partial<Omit<OnboardingConfig, 'id' | 'commandCenterId'>>): Promise<OnboardingConfig> {
    const ccId = getCCId();

    const { data, error } = await supabase
      .from('onboarding_config')
      .upsert(
        {
          command_center_id: ccId,
          reply_to_email: config.replyToEmail || null,
          facebook_group_url: config.facebookGroupUrl || null,
          facebook_page_url: config.facebookPageUrl || null,
          instagram_url: config.instagramUrl || null,
          instagram_handle: config.instagramHandle || null,
          signature_name: config.signatureName || null,
          signature_title: config.signatureTitle || null,
          signature_phone: config.signaturePhone || null,
          signature_email: config.signatureEmail || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'command_center_id' }
      )
      .select()
      .single();

    if (error) throw new Error(error.message);
    return this.mapDbToConfig(data);
  }

  // ---------------------------------------------------------------
  // SEND ONBOARDING EMAIL
  // ---------------------------------------------------------------

  public async sendOnboardingEmail(emailData: OnboardingEmailData): Promise<void> {
    const config = await this.getConfig();
    const shuttlePoint = emailData.shuttle
      ? await this.getShuttlePointByNumber(emailData.shuttle)
      : null;

    // Build the HTML
    const html = this.buildOnboardingEmailHtml(emailData, config, shuttlePoint);
    const subject = `Welcome to ${emailData.commandCenterName}, ${emailData.firstName}!`;

    // Call the Edge Function
    const { data, error } = await supabase.functions.invoke('bright-processor', {
      body: {
        emailType: 'onboarding',
        customerEmail: emailData.email,
        subject,
        html,
        replyTo: config?.replyToEmail || undefined,
        commandCenterId: emailData.commandCenterId,
        fromAddress: 'onboarding@propertystars.app',
      },
    });

    if (error) throw new Error(error.message || 'Failed to send onboarding email');

    // Mark contractor as emailed
    await supabase
      .from('contractors')
      .update({ onboarding_email_sent_at: new Date().toISOString() })
      .eq('contractor_id', emailData.contractorId)
      .eq('command_center_id', emailData.commandCenterId);
  }

  // ---------------------------------------------------------------
  // SEND LEVEL 2 UNLOCK EMAIL
  // ---------------------------------------------------------------

  public async sendLevel2UnlockEmail(emailData: Level2UnlockEmailData): Promise<void> {
    const config = await this.getConfig();

    const html = this.buildLevel2UnlockEmailHtml(emailData, config);
    const subject = `Level 2 Training Now Available, ${emailData.firstName}! 🚀`;

    const { data, error } = await supabase.functions.invoke('bright-processor', {
      body: {
        emailType: 'onboarding',
        customerEmail: emailData.email,
        subject,
        html,
        replyTo: config?.replyToEmail || undefined,
        commandCenterId: emailData.commandCenterId,
        fromAddress: 'onboarding@propertystars.app',
      },
    });

    if (error) throw new Error(error.message || 'Failed to send Level 2 unlock email');
  }

  // ---------------------------------------------------------------
  // LEVEL 2 UNLOCK EMAIL HTML BUILDER
  // ---------------------------------------------------------------

  public buildLevel2UnlockEmailHtml(
    emailData: Level2UnlockEmailData,
    config: OnboardingConfig | null
  ): string {
    const { firstName, contractorId, commandCenterName } = emailData;

    // Signature
    const hasSignature = config?.signatureName;
    const signatureHtml = hasSignature
      ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 25px; border-top: 1px solid #e5e7eb; padding-top: 20px;">
          <tr>
            <td style="font-size: 14px; color: #374151;">
              <strong style="font-size: 16px;">${config.signatureName}</strong><br/>
              ${config.signatureTitle ? `<span style="color: #6b7280;">${config.signatureTitle}</span><br/>` : ''}
              ${config.signaturePhone ? `<span style="color: #6b7280;">📞 ${config.signaturePhone}</span><br/>` : ''}
              ${config.signatureEmail ? `<span style="color: #6b7280;">✉️ ${config.signatureEmail}</span>` : ''}
            </td>
          </tr>
        </table>
      `
      : '';

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
              <img src="${LOGO_URL}" alt="${commandCenterName}" style="max-width: 200px; height: auto;" />
            </td>
          </tr>

          <!-- Heading -->
          <tr>
            <td style="padding: 30px 30px 10px 30px;">
              <h1 style="margin: 0; color: #1f2937; font-size: 24px;">Level 2 Training Unlocked! 🚀</h1>
              <p style="margin: 10px 0 0 0; color: #4b5563; font-size: 16px; line-height: 1.6;">
                Great work, ${firstName}! Your manager has unlocked <strong>Level 2 Training</strong> for you. Five new advanced modules are now available in your training portal.
              </p>
            </td>
          </tr>

          <!-- What's in Level 2 -->
          <tr>
            <td style="padding: 15px 30px;">
              <h2 style="margin: 0 0 12px 0; color: #1f2937; font-size: 18px;">📚 What's in Level 2?</h2>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;">
                <tr>
                  <td style="padding: 18px; font-size: 14px; color: #166534; line-height: 2;">
                    <strong>Module 6:</strong> Goal-Setting Your Way to the Top<br/>
                    <strong>Module 7:</strong> Time Management & Working Like a Star<br/>
                    <strong>Module 8:</strong> Route Strategy & Reading Your Territory<br/>
                    <strong>Module 9:</strong> Turning Negatives into Positives<br/>
                    <strong>Module 10:</strong> Your CPS Career & Financial Freedom
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Description -->
          <tr>
            <td style="padding: 10px 30px;">
              <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.6;">
                These modules cover advanced strategies from the CPS playbook — goal-setting frameworks, time management, route mastery, mental toughness, career development, and personal finance. Each module includes a quiz you'll need to pass at 80% or higher.
              </p>
            </td>
          </tr>

          <!-- Login Instructions -->
          <tr>
            <td style="padding: 15px 30px;">
              <h2 style="margin: 0 0 12px 0; color: #1f2937; font-size: 18px;">💻 Log In to Get Started</h2>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px;">
                <tr>
                  <td style="padding: 18px; font-size: 14px; color: #1e40af; line-height: 1.8;">
                    <strong>Website:</strong> <a href="https://propertystars.app" style="color: #2563eb; font-weight: bold;">propertystars.app</a><br/>
                    <strong>Username:</strong> <span style="font-size: 16px; font-weight: bold; color: #1e3a8a;">${contractorId}</span><br/>
                    <strong>Password:</strong> <span style="font-size: 16px; font-weight: bold; color: #1e3a8a;">${firstName}</span> <span style="font-size: 12px; color: #6b7280;">(case sensitive)</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Motivational CTA -->
          <tr>
            <td style="padding: 10px 30px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #059669 0%, #047857 100%); border-radius: 8px;">
                <tr>
                  <td style="padding: 20px; text-align: center;">
                    <p style="margin: 0; color: #ffffff; font-size: 16px; font-weight: bold;">
                      🏆 Take your game to the next level — complete all 5 modules!
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Signature -->
          ${hasSignature ? `
          <tr>
            <td style="padding: 20px 30px 10px 30px;">
              ${signatureHtml}
            </td>
          </tr>
          ` : ''}

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 30px 30px 30px; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                © 2026 ${commandCenterName}. All rights reserved.
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
  }

  // ---------------------------------------------------------------
  // ONBOARDING EMAIL HTML BUILDER
  // ---------------------------------------------------------------

  public buildOnboardingEmailHtml(
    emailData: OnboardingEmailData,
    config: OnboardingConfig | null,
    shuttlePoint: ShuttlePoint | null
  ): string {
    const { firstName, contractorId, firstDayBooked, shuttle } = emailData;

    // First day display
    const firstDayDisplay = firstDayBooked || 'No Shift Booked Yet';
    const firstDayColor = firstDayBooked ? '#166534' : '#92400e';
    const firstDayBg = firstDayBooked ? '#f0fdf4' : '#fef3c7';
    const firstDayBorder = firstDayBooked ? '#bbf7d0' : '#fde68a';

    // Shuttle display
    const hasShuttle = shuttle && shuttlePoint;
    const shuttleDisplay = hasShuttle
      ? `
        <strong>${shuttlePoint.description}</strong><br/>
        <span style="color: #4b5563;">Pickup Time: ${shuttlePoint.pickupTime}</span>
        ${shuttlePoint.googleMapsUrl ? `<br/><a href="${shuttlePoint.googleMapsUrl}" style="color: #2563eb; text-decoration: underline; font-weight: bold;">📍 View on Google Maps</a>` : ''}
      `
      : shuttle
        ? `Shuttle #${shuttle} — <span style="color: #92400e;">details not yet configured</span>`
        : '<span style="color: #92400e;">No Shuttle Assigned</span>';
    const shuttleBg = hasShuttle ? '#eff6ff' : '#fef3c7';
    const shuttleBorder = hasShuttle ? '#bfdbfe' : '#fde68a';

    // Social links
    const fbGroupLink = config?.facebookGroupUrl
      ? `<a href="${config.facebookGroupUrl}" style="color: #2563eb; text-decoration: none; font-weight: bold;">📘 Join our Facebook Group</a>`
      : '';
    const fbPageLink = config?.facebookPageUrl
      ? `<a href="${config.facebookPageUrl}" style="color: #2563eb; text-decoration: none; font-weight: bold;">📘 Like our Facebook Page</a>`
      : '';
    const instaLink = config?.instagramUrl
      ? `<a href="${config.instagramUrl}" style="color: #e1306c; text-decoration: none; font-weight: bold;">📸 Follow us on Instagram${config.instagramHandle ? ` (@${config.instagramHandle})` : ''}</a>`
      : '';
    const hasSocials = fbGroupLink || fbPageLink || instaLink;

    // Signature
    const hasSignature = config?.signatureName;
    const signatureHtml = hasSignature
      ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 25px; border-top: 1px solid #e5e7eb; padding-top: 20px;">
          <tr>
            <td style="font-size: 14px; color: #374151;">
              <strong style="font-size: 16px;">${config.signatureName}</strong><br/>
              ${config.signatureTitle ? `<span style="color: #6b7280;">${config.signatureTitle}</span><br/>` : ''}
              ${config.signaturePhone ? `<span style="color: #6b7280;">📞 ${config.signaturePhone}</span><br/>` : ''}
              ${config.signatureEmail ? `<span style="color: #6b7280;">✉️ ${config.signatureEmail}</span>` : ''}
            </td>
          </tr>
        </table>
      `
      : '';

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
              <img src="${LOGO_URL}" alt="${emailData.commandCenterName}" style="max-width: 200px; height: auto;" />
            </td>
          </tr>

          <!-- Welcome Greeting -->
          <tr>
            <td style="padding: 30px 30px 10px 30px;">
              <h1 style="margin: 0; color: #1f2937; font-size: 24px;">Welcome to the Team, ${firstName}! 🎉</h1>
              <p style="margin: 10px 0 0 0; color: #4b5563; font-size: 16px; line-height: 1.6;">
                We're excited to have you on board at <strong>${emailData.commandCenterName}</strong>. Here's everything you need to know to get started.
              </p>
            </td>
          </tr>

          <!-- Contractor ID -->
          <tr>
            <td style="padding: 15px 30px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;">
                <tr>
                  <td style="padding: 18px; font-size: 14px; color: #166534;">
                    <strong style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #15803d;">Your Contractor ID</strong><br/>
                    <span style="font-size: 28px; font-weight: bold; color: #166534; letter-spacing: 1px;">${contractorId}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- First Day -->
          <tr>
            <td style="padding: 10px 30px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${firstDayBg}; border: 1px solid ${firstDayBorder}; border-radius: 8px;">
                <tr>
                  <td style="padding: 18px; font-size: 14px; color: ${firstDayColor};">
                    <strong style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Your First Day</strong><br/>
                    <span style="font-size: 22px; font-weight: bold;">${firstDayDisplay}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Shuttle Point -->
          <tr>
            <td style="padding: 10px 30px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${shuttleBg}; border: 1px solid ${shuttleBorder}; border-radius: 8px;">
                <tr>
                  <td style="padding: 18px; font-size: 14px; color: #1e40af;">
                    <strong style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #1e3a8a;">🚐 Your Shuttle Point</strong><br/>
                    <div style="margin-top: 8px; font-size: 15px; line-height: 1.6;">
                      ${shuttleDisplay}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- How to Prepare -->
          <tr>
            <td style="padding: 15px 30px;">
              <h2 style="margin: 0 0 12px 0; color: #1f2937; font-size: 18px;">📋 How to Prepare for Your First Day</h2>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
                <tr>
                  <td style="padding: 18px; font-size: 14px; color: #374151; line-height: 2;">
                    <strong>1.</strong> Show up on time — the earlier the better (DOOR OPENS AT 8:10am)<br/>
                    <strong>2.</strong> Bring a backpack<br/>
                    <strong>3.</strong> Bring food and drinks for the day<br/>
                    <strong>4.</strong> Bring clothing based on weather forecast (if rain is forecast, be prepared)<br/>
                    <strong>5.</strong> Bring sunscreen for sun and extra socks for wet days<br/>
                    <strong>6.</strong> Good pair of footwear — mandatory high quality shoes/work-boots/steel toes (no old shoes or sandals)<br/>
                    <strong>7.</strong> Plenty of sleep the night before<br/>
                    <strong>8.</strong> Winning attitude and ready mind to learn and be trained
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Online Training Login -->
          <tr>
            <td style="padding: 10px 30px;">
              <h2 style="margin: 0 0 12px 0; color: #1f2937; font-size: 18px;">💻 Complete Your Online Training</h2>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px;">
                <tr>
                  <td style="padding: 18px; font-size: 14px; color: #1e40af; line-height: 1.8;">
                    Please complete your online training modules before your first day:<br/><br/>
                    <strong>Website:</strong> <a href="https://propertystars.app" style="color: #2563eb; font-weight: bold;">propertystars.app</a><br/>
                    <strong>Username:</strong> <span style="font-size: 16px; font-weight: bold; color: #1e3a8a;">${contractorId}</span><br/>
                    <strong>Password:</strong> <span style="font-size: 16px; font-weight: bold; color: #1e3a8a;">${firstName}</span> <span style="font-size: 12px; color: #6b7280;">(case sensitive)</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Social Media -->
          ${hasSocials ? `
          <tr>
            <td style="padding: 15px 30px;">
              <h2 style="margin: 0 0 12px 0; color: #1f2937; font-size: 18px;">🌟 Join Our Community</h2>
              <p style="margin: 0 0 12px 0; color: #4b5563; font-size: 14px;">
                Join right away for updates on contests, announcements, and team news!
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
                <tr>
                  <td style="padding: 18px; font-size: 15px; line-height: 2.2;">
                    ${fbGroupLink ? `${fbGroupLink}<br/>` : ''}
                    ${fbPageLink ? `${fbPageLink}<br/>` : ''}
                    ${instaLink ? `${instaLink}<br/>` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ` : ''}

          <!-- Referral Link -->
          <tr>
            <td style="padding: 10px 30px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%); border-radius: 8px;">
                <tr>
                  <td style="padding: 20px; text-align: center;">
                    <p style="margin: 0 0 8px 0; color: #e9d5ff; font-size: 14px;">Know someone who'd be a great fit?</p>
                    <a href="https://www.propertystarsjobs.com" style="color: #ffffff; font-size: 18px; font-weight: bold; text-decoration: none;">
                      🤝 Refer a Friend → propertystarsjobs.com
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Signature -->
          ${hasSignature ? `
          <tr>
            <td style="padding: 20px 30px 10px 30px;">
              ${signatureHtml}
            </td>
          </tr>
          ` : ''}

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 30px 30px 30px; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                © 2026 ${emailData.commandCenterName}. All rights reserved.
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
  }

  // ---------------------------------------------------------------
  // PREVIEW (sample data)
  // ---------------------------------------------------------------

  public buildPreviewHtml(
    config: OnboardingConfig | null,
    shuttlePoints: ShuttlePoint[],
    ccName: string
  ): string {
    const sampleShuttle = shuttlePoints.length > 0 ? shuttlePoints[0] : null;

    return this.buildOnboardingEmailHtml(
      {
        contractorId: 'H1001',
        firstName: 'John',
        lastName: 'Smith',
        email: 'john@example.com',
        shuttle: sampleShuttle?.shuttleNumber || '5',
        firstDayBooked: 'Mar26',
        commandCenterId: '',
        commandCenterName: ccName,
      },
      config,
      sampleShuttle
    );
  }

  // ---------------------------------------------------------------
  // MAPPERS
  // ---------------------------------------------------------------

  private mapDbToShuttlePoint(data: any): ShuttlePoint {
    return {
      id: data.id,
      commandCenterId: data.command_center_id,
      shuttleNumber: data.shuttle_number,
      description: data.description || '',
      pickupTime: data.pickup_time || '',
      googleMapsUrl: data.google_maps_url || '',
      createdAt: data.created_at,
    };
  }

  private mapDbToConfig(data: any): OnboardingConfig {
    return {
      id: data.id,
      commandCenterId: data.command_center_id,
      replyToEmail: data.reply_to_email || '',
      facebookGroupUrl: data.facebook_group_url || '',
      facebookPageUrl: data.facebook_page_url || '',
      instagramUrl: data.instagram_url || '',
      instagramHandle: data.instagram_handle || '',
      signatureName: data.signature_name || '',
      signatureTitle: data.signature_title || '',
      signaturePhone: data.signature_phone || '',
      signatureEmail: data.signature_email || '',
      updatedAt: data.updated_at,
    };
  }
}

export const onboardingService = OnboardingService.getInstance();