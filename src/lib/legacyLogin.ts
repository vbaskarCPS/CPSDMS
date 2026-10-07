// src/lib/legacyLogin.ts — the old app's universal login, so the new sign-in page can serve
// everyone the old home page served: workers (CN # + first name), training, route managers
// still on old accounts, command-center logins, campaign managers and the maps viewer.
// Same checks, same order, same landing pages as src/pages/HomePage.tsx.
import { sessionService } from './sessionService';
import { commandCenterService, isSuperAdminCredentials } from './commandCenterService';
import { campaignService } from './campaignService';
import { contractorService } from './contractorService';
import { setStorageItem } from './localStorage';
import { isTrainingCredentials, TRAINING_WORKER } from './trainingData';
import { trainingService } from './trainingService';
import { googleAuthService } from './googleAuthService';
import { workerLandingPath } from './mapLogsheetService';

export type LegacyLoginResult = { path: string } | { finalized: true } | null;

/** Signs in with the old app's accounts. Returns where to go, or null when nothing matched. */
export async function legacyLogin(username: string, password: string, opts: { workersOnly?: boolean } = {}): Promise<LegacyLoginResult> {
  googleAuthService.signOut();
  try {
    if (!opts.workersOnly) {
      if (username.trim().toLowerCase() === 'digimaps' && password === 'viewer') {
        trainingService.disableTrainingMode();
        commandCenterService.clearCurrentCommandCenter();
        commandCenterService.setSuperAdminMode(false);
        setStorageItem('digimaps_viewer', true);
        return { path: '/digimaps' };
      }
    }
    if (isTrainingCredentials(username, password)) {
      trainingService.enableTrainingMode();
      setStorageItem('current_user', TRAINING_WORKER);
      return { path: '/logsheet' };
    }
    if (!opts.workersOnly) {
      if (isSuperAdminCredentials(username, password)) {
        trainingService.disableTrainingMode();
        commandCenterService.clearCurrentCommandCenter();
        commandCenterService.setSuperAdminMode(false);
        return { path: '/super-admin' };
      }
      const cc = await commandCenterService.authenticateCommandCenter(username, password);
      if (cc) {
        trainingService.disableTrainingMode();
        commandCenterService.setCurrentCommandCenter(cc);
        commandCenterService.setSuperAdminMode(false);
        try { await googleAuthService.authenticate(); } catch (err) { console.warn('Google sign-in was not completed at login:', err); }
        return { path: '/admin' };
      }
      const rm = await sessionService.authenticateRM(username, password);
      if (rm) {
        trainingService.disableTrainingMode();
        setStorageItem('current_user', rm);
        return { path: '/rm-logbook' };
      }
    }
    const worker = await sessionService.authenticateWorker(username, password);
    if (worker) {
      trainingService.disableTrainingMode();
      setStorageItem('current_user', worker);
      await sessionService.startLogsheetSession(worker.contractorId);
      return { path: await workerLandingPath(worker) };
    }
    const activeCCId = await contractorService.findActiveSessionAcrossAllCCs(username);
    if (activeCCId) {
      trainingService.disableTrainingMode();
      const activeCC = await commandCenterService.getCommandCenterById(activeCCId);
      if (activeCC) commandCenterService.setCurrentCommandCenter(activeCC);
      const roaming = await sessionService.authenticateWorker(username, password);
      if (roaming) {
        setStorageItem('current_user', roaming);
        await sessionService.startLogsheetSession(roaming.contractorId);
        return { path: await workerLandingPath(roaming) };
      }
    }
    const contractor = await contractorService.authenticateContractor(username, password);
    if (contractor) {
      trainingService.disableTrainingMode();
      contractorService.setCurrentTrainingContractor({
        contractorId: contractor.contractorId, firstName: contractor.firstName, lastName: contractor.lastName,
        commandCenterId: contractor.commandCenterId, region: contractor.region,
        level2UnlockedAt: contractor.level2UnlockedAt, level3UnlockedAt: contractor.level3UnlockedAt,
      });
      return { path: '/training' };
    }
    if (!opts.workersOnly) {
      const campaignAuth = await campaignService.authenticateCampaignManager(username, password);
      if (campaignAuth) {
        trainingService.disableTrainingMode();
        campaignService.setCurrentManager(campaignAuth.manager);
        campaignService.setCurrentCampaign(campaignAuth.campaign);
        return { path: '/dialer' };
      }
    }
    return null;
  } catch (err) {
    if (err instanceof Error && err.message === 'SESSION_FINALIZED') return { finalized: true };
    throw err;
  }
}
