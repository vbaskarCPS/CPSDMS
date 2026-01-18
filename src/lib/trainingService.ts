// src/lib/trainingService.ts
import { 
    Worker, 
    ManagementUser, 
    MasterBooking, 
    SessionTransaction, 
    SessionStats,
    LogsheetSession 
  } from '../types';
  import {
    TRAINING_WORKER,
    TRAINING_MANAGER,
    TRAINING_ROUTE,
    TRAINING_ROUTE_CODE,
    TRAINING_WORKER_ID,
    getTrainingBookings,
  } from './trainingData';
  
  // --- STORAGE KEYS (using sessionStorage for isolation) ---
  const TRAINING_BOOKINGS_KEY = 'training_bookings';
  const TRAINING_TRANSACTIONS_KEY = 'training_transactions';
  const TRAINING_STATS_KEY = 'training_stats';
  const TRAINING_MODE_KEY = 'is_training_mode';
  
  // --- TRAINING TAX RATE (West = 5%) ---
  const TRAINING_TAX_RATE = 5;
  
  class TrainingService {
    private static instance: TrainingService;
    
    private constructor() {}
    
    public static getInstance(): TrainingService {
      if (!TrainingService.instance) {
        TrainingService.instance = new TrainingService();
      }
      return TrainingService.instance;
    }
  
    // --- MODE MANAGEMENT ---
  
    public isTrainingMode(): boolean {
      return sessionStorage.getItem(TRAINING_MODE_KEY) === 'true';
    }
  
    public enableTrainingMode(): void {
      sessionStorage.setItem(TRAINING_MODE_KEY, 'true');
      // Initialize fresh training data
      this.initializeTrainingData();
    }
  
    public disableTrainingMode(): void {
      sessionStorage.removeItem(TRAINING_MODE_KEY);
      sessionStorage.removeItem(TRAINING_BOOKINGS_KEY);
      sessionStorage.removeItem(TRAINING_TRANSACTIONS_KEY);
      sessionStorage.removeItem(TRAINING_STATS_KEY);
    }
  
    private initializeTrainingData(): void {
      // Only initialize if not already set
      if (!sessionStorage.getItem(TRAINING_BOOKINGS_KEY)) {
        const bookings = getTrainingBookings();
        sessionStorage.setItem(TRAINING_BOOKINGS_KEY, JSON.stringify(bookings));
      }
      if (!sessionStorage.getItem(TRAINING_TRANSACTIONS_KEY)) {
        sessionStorage.setItem(TRAINING_TRANSACTIONS_KEY, JSON.stringify([]));
      }
      if (!sessionStorage.getItem(TRAINING_STATS_KEY)) {
        sessionStorage.setItem(TRAINING_STATS_KEY, JSON.stringify(this.getEmptyStats()));
      }
    }
  
    // --- DATA GETTERS ---
  
    public getWorker(): Worker {
      return TRAINING_WORKER;
    }
  
    public getManager(): ManagementUser {
      return TRAINING_MANAGER;
    }
  
    public getManagerById(managerId: string): ManagementUser | null {
      if (managerId === TRAINING_MANAGER.userId) {
        return TRAINING_MANAGER;
      }
      return null;
    }
  
    public getBookings(): MasterBooking[] {
      const stored = sessionStorage.getItem(TRAINING_BOOKINGS_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
      const bookings = getTrainingBookings();
      sessionStorage.setItem(TRAINING_BOOKINGS_KEY, JSON.stringify(bookings));
      return bookings;
    }
  
    public getTransactions(): SessionTransaction[] {
      const stored = sessionStorage.getItem(TRAINING_TRANSACTIONS_KEY);
      return stored ? JSON.parse(stored) : [];
    }
  
    private saveTransactions(transactions: SessionTransaction[]): void {
      sessionStorage.setItem(TRAINING_TRANSACTIONS_KEY, JSON.stringify(transactions));
    }
  
    private saveBookings(bookings: MasterBooking[]): void {
      sessionStorage.setItem(TRAINING_BOOKINGS_KEY, JSON.stringify(bookings));
    }
  
    public getStats(): SessionStats {
      const stored = sessionStorage.getItem(TRAINING_STATS_KEY);
      return stored ? JSON.parse(stored) : this.getEmptyStats();
    }
  
    private saveStats(stats: SessionStats): void {
      sessionStorage.setItem(TRAINING_STATS_KEY, JSON.stringify(stats));
    }
  
    // --- WORKER ASSIGNMENTS ---
  
    public async getWorkerAssignments(workerId: string): Promise<MasterBooking[]> {
      const bookings = this.getBookings();
      const transactions = this.getTransactions();
  
      // Get pending bookings
      const pending = bookings.filter(b => 
        b.Status !== 'completed' && 
        b.Status !== 'cancelled' && 
        b.Status !== 'next_time'
      );
  
      // Convert transactions to completed booking format
      const completed = transactions.map(tx => ({
        'Booking ID': tx.jobId,
        'First Name': tx.customerName.split(' ')[0],
        'Last Name': tx.customerName.split(' ').slice(1).join(' '),
        'Full Address': tx.address,
        'Completed': 'x',
        'Status': 'completed',
        'Price': tx.displayPrice,
        'Route Number': tx.routeCode,
        'Log Sheet Notes': tx.itemDescription,
        'Home Phone': tx.customerPhone,
        'Email Address': tx.customerEmail,
        'Payment Method': tx.paymentMethod,
        'paymentBreakdown': tx.paymentBreakdown,
        'FO/BO/FP': tx.serviceType,
        'Contract Title': tx.items?.[0]?.name || tx.serviceName || tx.displayPrice,
        'invoiceNumber': tx.invoiceNumber,
        'chequeNumber': tx.chequeNumber,
        'etransferEmail': tx.etransferEmail,
        isContract: ['Upgrade', 'Add-On'].includes(tx.type),
        isUpgrade: tx.type === 'Upgrade',
        isAddOn: tx.type === 'Add-On',
        isNewSale: tx.type === 'Sale',
        Prepaid: tx.isPrepaid ? 'x' : undefined,
      } as MasterBooking));
  
      return [...pending, ...completed];
    }
  
    public async getStreetsForRoute(routeCode: string): Promise<string[]> {
      if (routeCode === TRAINING_ROUTE_CODE) {
        return TRAINING_ROUTE.streets || [];
      }
      return [];
    }
  
    // --- SESSION MANAGEMENT ---
  
    public async startLogsheetSession(workerId: string): Promise<LogsheetSession> {
      this.initializeTrainingData();
      return {
        id: `training_session_${Date.now()}`,
        workerId: TRAINING_WORKER_ID,
        date: new Date().toISOString().split('T')[0],
        status: 'OPEN',
        stats: this.getStats(),
        dailyRouteStore: [],
        financialStore: this.getTransactions(),
      };
    }
  
    public async getActiveLogsheetSession(workerId: string): Promise<LogsheetSession | null> {
      return {
        id: `training_session_${Date.now()}`,
        workerId: TRAINING_WORKER_ID,
        date: new Date().toISOString().split('T')[0],
        status: 'OPEN',
        stats: this.getStats(),
        dailyRouteStore: [],
        financialStore: this.getTransactions(),
      };
    }
  
    public async getDailySession(): Promise<any> {
      return {
        date: new Date().toISOString().split('T')[0],
        routes: [TRAINING_ROUTE],
      };
    }
  
    public async getWorkerUpsellsEnabled(workerId: string): Promise<boolean> {
      return true; // Always enabled in training
    }
  
    public async isWorkerLockedOut(workerId: string): Promise<boolean> {
      return false; // Never locked out in training
    }
  
    // --- JOB COMPLETION ---
  
    public async completeJob(
      transaction: SessionTransaction, 
      jobId: string, 
      workerId: string
    ): Promise<void> {
      const transactions = this.getTransactions();
      const bookings = this.getBookings();
  
      // Check if this is an update to existing transaction
      const existingIndex = transactions.findIndex(t => t.jobId === jobId);
      if (existingIndex >= 0) {
        transactions[existingIndex] = transaction;
      } else {
        transactions.push(transaction);
      }
  
      // Update booking status if it's a prebook
      const bookingIndex = bookings.findIndex(b => b['Booking ID'] === jobId);
      if (bookingIndex >= 0) {
        bookings[bookingIndex].Status = 'completed';
        bookings[bookingIndex].Completed = 'x';
      }
  
      this.saveTransactions(transactions);
      this.saveBookings(bookings);
  
      // Recalculate and save stats
      const newStats = this.recalculateStats(transactions, TRAINING_TAX_RATE);
      this.saveStats(newStats);
    }
  
    public async updateBookingStatus(bookingId: string, status: 'next_time' | 'cancelled'): Promise<void> {
      const bookings = this.getBookings();
      const index = bookings.findIndex(b => b['Booking ID'] === bookingId);
      if (index >= 0) {
        bookings[index].Status = status;
        this.saveBookings(bookings);
      }
    }
  
    public async revertTransaction(transactionId: string, jobId?: string): Promise<void> {
      let transactions = this.getTransactions();
      transactions = transactions.filter(t => t.id !== transactionId);
      this.saveTransactions(transactions);
  
      // Revert booking status if applicable
      if (jobId && !jobId.startsWith('NEW-')) {
        const bookings = this.getBookings();
        const index = bookings.findIndex(b => b['Booking ID'] === jobId);
        if (index >= 0) {
          bookings[index].Status = 'pending';
          bookings[index].Completed = undefined;
          this.saveBookings(bookings);
        }
      }
  
      // Recalculate stats
      const newStats = this.recalculateStats(transactions, TRAINING_TAX_RATE);
      this.saveStats(newStats);
    }
  
    public async getTransactionByJobId(jobId: string): Promise<SessionTransaction | null> {
      const transactions = this.getTransactions();
      return transactions.find(t => t.jobId === jobId) || null;
    }
  
    public async updateLogsheetSession(sessionId: string, updates: Partial<LogsheetSession>): Promise<void> {
      if (updates.stats) {
        this.saveStats(updates.stats);
      }
    }
  
    // --- STATS CALCULATION ---
  
    public getEmptyStats(): SessionStats {
      return {
        prodPrepaid: 0, prodBilled: 0, prodCash: 0, prodCheque: 0, prodETransfer: 0, prodCreditCard: 0, prodFlats: 0, prodPrepaidSplit: 0,
        prodGross: 0, prodPayable: 0, totalEQ: 0,
        upsellCash: 0, upsellCheque: 0, upsellETransfer: 0, upsellCreditCard: 0, upsellBilled: 0, upsellPrepaid: 0,
        upsellGross: 0, upsellPayable: 0,
        stepCount: 0, upsellCount: 0, iosCount: 0,
      };
    }
  
    public recalculateStats(financials: SessionTransaction[], taxRate: number = 5): SessionStats {
      const stats = this.getEmptyStats();
      const taxDivisor = 1 + taxRate / 100;
  
      financials.forEach((tx) => {
        if (['Production', 'Sale', 'Upgrade'].includes(tx.type)) stats.stepCount++;
        if (['Upgrade', 'Add-On'].includes(tx.type)) stats.upsellCount++;
        if (tx.paymentMethod === 'IOS') stats.iosCount++;
  
        const paymentMap: Record<string, number> = tx.paymentBreakdown || { [tx.paymentMethod]: tx.price };
  
        Object.entries(paymentMap).forEach(([method, amount]) => {
          const val = Number(amount) || 0;
          
          if (method === 'IOS') return;
          
          const addToBucket = (val: number, isProd: boolean) => {
            if (isProd) {
              if ((tx.type === 'Production') && (tx.displayPrice?.startsWith('RJ') || tx.displayPrice?.startsWith('SP'))) {
                stats.prodFlats += val;
              } else if (method.includes('Prepaid')) stats.prodPrepaid += val;
              else if (method.includes('Billed')) stats.prodBilled += val;
              else if (method.includes('Cash')) stats.prodCash += val;
              else if (method.includes('Cheque')) stats.prodCheque += val;
              else if (method.includes('E-Transfer')) stats.prodETransfer += val;
              else if (method.includes('Credit Card')) stats.prodCreditCard += val;
            } else {
              if (method.includes('Prepaid')) stats.upsellPrepaid += val;
              else if (method.includes('Billed')) stats.upsellBilled += val;
              else if (method.includes('Cash')) stats.upsellCash += val;
              else if (method.includes('Cheque')) stats.upsellCheque += val;
              else if (method.includes('E-Transfer')) stats.upsellETransfer += val;
              else if (method.includes('Credit Card')) stats.upsellCreditCard += val;
            }
          };
  
          if (tx.type === 'Production' || tx.type === 'Sale') {
            addToBucket(val, true);
          } else if (tx.type === 'Add-On') {
            addToBucket(val, false);
          } else if (tx.type === 'Upgrade') {
            addToBucket(val * 0.8, false);
            if (method.includes('Prepaid')) {
              stats.prodPrepaidSplit += (val * 0.2);
            } else {
              addToBucket(val * 0.2, true);
            }
          }
        });
      });
  
      stats.prodGross = stats.prodPrepaid + stats.prodBilled + stats.prodCash + stats.prodCheque + stats.prodETransfer + stats.prodCreditCard + stats.prodFlats + stats.prodPrepaidSplit;
      
      const weightedProd = 
          (stats.prodPrepaid * 0.5) + 
          (stats.prodBilled * 0.5) + 
          stats.prodCash + 
          stats.prodCheque + 
          stats.prodETransfer + 
          stats.prodCreditCard + 
          stats.prodFlats + 
          stats.prodPrepaidSplit;
  
      stats.prodPayable = weightedProd / taxDivisor;
      stats.totalEQ = stats.prodPayable / 25;
      stats.upsellGross = stats.upsellBilled + stats.upsellCash + stats.upsellCheque + stats.upsellETransfer + stats.upsellCreditCard + stats.upsellPrepaid;
      stats.upsellPayable = stats.upsellGross / taxDivisor;
  
      return stats;
    }
  }
  
  export const trainingService = TrainingService.getInstance();