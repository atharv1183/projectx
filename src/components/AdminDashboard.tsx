import { useState, useEffect, useRef, FormEvent } from 'react';
import { db } from '../lib/firebase';
import { initializeApp, deleteApp } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, signOut } from 'firebase/auth';
import { 
  collection, 
  query, 
  addDoc, 
  setDoc,
  deleteDoc,
  doc, 
  updateDoc, 
  serverTimestamp, 
  orderBy, 
  onSnapshot,
  where,
  limit,
  getDocs,
  runTransaction,
  writeBatch,
  Timestamp
} from 'firebase/firestore';
import { Lead, User, LeadStatus, OperationType, Requirement } from '../types';
import { handleFirestoreError } from '../lib/utils';
import InventoryManagement from './InventoryManagement';
import { 
  Users, 
  UserPlus, 
  ClipboardList, 
  Plus, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Search,
  History,
  ArrowLeftRight,
  MessageSquare,
  XSquare,
  Phone,
  Loader2,
  FileText,
  MapPin,
  Trash2,
  LayoutGrid,
  Download,
  Upload,
  Database
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format } from 'date-fns';
import { Followup } from '../types';
import firebaseConfig from '../../firebase-applet-config.json';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function LeadTimeline({ leadId }: { leadId: string }) {
  const [followups, setFollowups] = useState<Followup[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'leads', leadId, 'followups'), orderBy('date', 'desc'));
    const unsub = onSnapshot(q, (sn) => setFollowups(sn.docs.map(d => ({ id: d.id, ...d.data() } as Followup))));
    return unsub;
  }, [leadId]);

  return (
    <div className="relative space-y-4 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-100">
      {followups.map(f => (
        <div key={f.id} className="relative pl-8">
          <div className="absolute left-1.5 top-1.5 w-3 h-3 rounded-full bg-blue-500 border-2 border-white shadow-sm" />
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">{f.date?.toDate ? format(f.date.toDate(), 'MMM dd, hh:mm a') : 'Just now'}</p>
          <div className="p-3 bg-white border border-gray-100 rounded-xl shadow-sm text-sm text-gray-700 font-medium leading-relaxed">
            {f.remark}
          </div>
        </div>
      ))}
      {followups.length === 0 && <p className="text-center py-4 text-gray-400 text-sm">No history yet.</p>}
    </div>
  );
}

const formatLeadDate = (date: any) => {
  if (!date) return 'Just now';
  const d = date.toDate ? date.toDate() : (date.seconds ? new Date(date.seconds * 1000) : new Date(date));
  return format(d, 'MMM dd, yyyy hh:mm a');
};

export default function AdminDashboard({ user, backSignal = 0 }: { user: User; backSignal?: number }) {
  const [activeView, setActiveView] = useState<'leads' | 'employees' | 'attendance' | 'requirements' | 'inventory'>('leads');
  const [employees, setEmployees] = useState<User[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [showAddLead, setShowAddLead] = useState(false);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [showEditEmployee, setShowEditEmployee] = useState<User | null>(null);
  const [leadForm, setLeadForm] = useState({ name: '', phone: '', source: '' });
  const [leadAllocationMode, setLeadAllocationMode] = useState<'auto' | 'manual'>('auto');
  const [manualLeadAssigneeId, setManualLeadAssigneeId] = useState('');
  const [employeeForm, setEmployeeForm] = useState({ name: '', phone: '' });
  const [loading, setLoading] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferSearch, setTransferSearch] = useState('');
  const [interactionRemark, setInteractionRemark] = useState('');
  const [nextFollowupDate, setNextFollowupDate] = useState('');

  // Reallocation State
  const [reallocateEmployee, setReallocateEmployee] = useState<User | null>(null);
  const [showReallocateModal, setShowReallocateModal] = useState(false);
  const [reallocateToMethod, setReallocateToMethod] = useState<'manual' | 'auto'>('auto');
  const [targetEmployeeId, setTargetEmployeeId] = useState('');
  const [reallocateLeadsCount, setReallocateLeadsCount] = useState(0);
  const [pendingRole, setPendingRole] = useState<'suspended' | 'deleted' | null>(null);
  const [saveToast, setSaveToast] = useState<{ title: string; description: string } | null>(null);
  const saveToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processedBackSignalRef = useRef(0);
  const tabsScrollRef = useRef<HTMLDivElement | null>(null);
  const leadsImportInputRef = useRef<HTMLInputElement | null>(null);
  const inventoryImportInputRef = useRef<HTMLInputElement | null>(null);
  const [canScrollTabsLeft, setCanScrollTabsLeft] = useState(false);
  const [canScrollTabsRight, setCanScrollTabsRight] = useState(false);
  const [dataToolsBusy, setDataToolsBusy] = useState<string | null>(null);

  const normalizePhone = (value: string) => value.replace(/\D/g, '');
  const showSaveToast = (title: string, description: string) => {
    setSaveToast({ title, description });
    if (saveToastTimerRef.current) {
      clearTimeout(saveToastTimerRef.current);
    }
    saveToastTimerRef.current = setTimeout(() => {
      setSaveToast(null);
      saveToastTimerRef.current = null;
    }, 4500);
  };

  const serializeFirestoreValue = (value: any): any => {
    if (value instanceof Timestamp) {
      return { __ts: value.toMillis() };
    }
    if (value && typeof value === 'object' && typeof value.toDate === 'function') {
      const parsed = value.toDate();
      if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
        return { __ts: parsed.getTime() };
      }
    }
    if (Array.isArray(value)) {
      return value.map((entry) => serializeFirestoreValue(entry));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, serializeFirestoreValue(v)])
      );
    }
    return value;
  };

  const deserializeFirestoreValue = (value: any): any => {
    if (Array.isArray(value)) {
      return value.map((entry) => deserializeFirestoreValue(entry));
    }
    if (value && typeof value === 'object') {
      if (typeof value.__ts === 'number') {
        return Timestamp.fromMillis(value.__ts);
      }
      if (typeof value.seconds === 'number' && typeof value.nanoseconds === 'number' && Object.keys(value).length <= 3) {
        return Timestamp.fromMillis(value.seconds * 1000 + Math.floor(value.nanoseconds / 1000000));
      }
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, deserializeFirestoreValue(v)])
      );
    }
    return value;
  };

  const downloadJsonFile = (filename: string, payload: any) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const exportLeadsData = async () => {
    setDataToolsBusy('export_leads');
    try {
      const leadsSnapshot = await getDocs(collection(db, 'leads'));
      const records = [];
      for (const leadDoc of leadsSnapshot.docs) {
        const followupsSnapshot = await getDocs(query(collection(db, 'leads', leadDoc.id, 'followups'), orderBy('date', 'asc')));
        records.push({
          id: leadDoc.id,
          data: serializeFirestoreValue(leadDoc.data()),
          followups: followupsSnapshot.docs.map((f) => ({
            id: f.id,
            data: serializeFirestoreValue(f.data()),
          })),
        });
      }

      downloadJsonFile(
        `leads-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
        { collection: 'leads', exportedAt: new Date().toISOString(), records }
      );
      alert(`Exported ${records.length} leads successfully.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'leads');
    } finally {
      setDataToolsBusy(null);
    }
  };

  const exportInventoryData = async () => {
    setDataToolsBusy('export_inventory');
    try {
      const snapshot = await getDocs(collection(db, 'inventory'));
      const records = snapshot.docs.map((d) => ({
        id: d.id,
        data: serializeFirestoreValue(d.data()),
      }));
      downloadJsonFile(
        `inventory-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
        { collection: 'inventory', exportedAt: new Date().toISOString(), records }
      );
      alert(`Exported ${records.length} inventory items successfully.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'inventory');
    } finally {
      setDataToolsBusy(null);
    }
  };

  const commitBatchedWrites = async (
    targetCollection: 'leads' | 'inventory',
    records: Array<{ id?: string; data: any; followups?: Array<{ id?: string; data: any }> }>
  ) => {
    let batch = writeBatch(db);
    let operations = 0;
    let importedRows = 0;

    const flush = async () => {
      if (operations === 0) return;
      await batch.commit();
      batch = writeBatch(db);
      operations = 0;
    };

    for (const record of records) {
      const data = deserializeFirestoreValue(record.data || {});
      const docId = record.id || doc(collection(db, targetCollection)).id;
      batch.set(doc(db, targetCollection, docId), data);
      operations += 1;
      importedRows += 1;

      if (targetCollection === 'leads' && Array.isArray(record.followups)) {
        for (const followup of record.followups) {
          const followupId = followup.id || doc(collection(db, 'leads', docId, 'followups')).id;
          batch.set(doc(db, 'leads', docId, 'followups', followupId), deserializeFirestoreValue(followup.data || {}));
          operations += 1;
          if (operations >= 450) {
            await flush();
          }
        }
      }

      if (operations >= 450) {
        await flush();
      }
    }

    await flush();
    return importedRows;
  };

  const importDataFile = async (targetCollection: 'leads' | 'inventory', file: File) => {
    setDataToolsBusy(`import_${targetCollection}`);
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const records = Array.isArray(parsed) ? parsed : parsed?.records;

      if (!Array.isArray(records) || records.length === 0) {
        alert('Selected file has no records to import.');
        return;
      }

      const importedCount = await commitBatchedWrites(targetCollection, records);
      alert(`Imported ${importedCount} ${targetCollection} records successfully.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Import failed. Please verify the JSON file format.');
    } finally {
      setDataToolsBusy(null);
    }
  };

  const deleteAllFollowupsForLead = async (leadId: string) => {
    while (true) {
      const snapshot = await getDocs(query(collection(db, 'leads', leadId, 'followups'), limit(300)));
      if (snapshot.empty) break;

      const batch = writeBatch(db);
      snapshot.docs.forEach((docItem) => batch.delete(docItem.ref));
      await batch.commit();
    }
  };

  const clearEntireInventory = async () => {
    if (!confirm('This will permanently delete ALL inventory records. Continue?')) return;
    if (!confirm('Please confirm again: delete entire inventory database now?')) return;

    setDataToolsBusy('clear_inventory');
    try {
      let deletedCount = 0;
      while (true) {
        const snapshot = await getDocs(query(collection(db, 'inventory'), limit(300)));
        if (snapshot.empty) break;
        const batch = writeBatch(db);
        snapshot.docs.forEach((docItem) => {
          batch.delete(docItem.ref);
          deletedCount += 1;
        });
        await batch.commit();
      }
      alert(`Cleared inventory database. Deleted ${deletedCount} documents.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'inventory');
    } finally {
      setDataToolsBusy(null);
    }
  };

  const clearEntireLeads = async () => {
    if (!confirm('This will permanently delete ALL leads and follow-up history. Continue?')) return;
    if (!confirm('Please confirm again: delete entire leads database now?')) return;

    setDataToolsBusy('clear_leads');
    try {
      let deletedLeads = 0;
      while (true) {
        const leadsSnapshot = await getDocs(query(collection(db, 'leads'), limit(120)));
        if (leadsSnapshot.empty) break;

        for (const leadDoc of leadsSnapshot.docs) {
          await deleteAllFollowupsForLead(leadDoc.id);
        }

        const batch = writeBatch(db);
        leadsSnapshot.docs.forEach((leadDoc) => {
          batch.delete(leadDoc.ref);
          deletedLeads += 1;
        });
        await batch.commit();
      }

      alert(`Cleared leads database. Deleted ${deletedLeads} leads (with their follow-ups).`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'leads');
    } finally {
      setDataToolsBusy(null);
    }
  };

  const handleReallocateAndChangeStatus = async () => {
    if (!reallocateEmployee || !pendingRole) return;
    if (reallocateToMethod === 'manual' && !targetEmployeeId) return alert('Select a person to reallocate leads to.');
    
    setLoading(true);
    try {
      const leadsToReallocate = leads.filter(l => l.assignedTo === reallocateEmployee.uid);
      const batch = writeBatch(db);
      const activeEmployees = employees.filter(e => e.uid !== reallocateEmployee.uid && e.role === 'employee');

      if (activeEmployees.length === 0 && reallocateToMethod === 'auto') {
        throw new Error('No other active employees available for automatic reallocation.');
      }

      leadsToReallocate.forEach((lead, index) => {
        const leadRef = doc(db, 'leads', lead.id);
        let newAssigneeId = targetEmployeeId;
        
        if (reallocateToMethod === 'auto') {
          newAssigneeId = activeEmployees[index % activeEmployees.length].uid;
        }

        const newAssigneeName = employees.find(e => e.uid === newAssigneeId)?.name || 'New Executive';

        batch.update(leadRef, {
          assignedTo: newAssigneeId,
          updatedAt: serverTimestamp()
        });

        const followupRef = doc(collection(db, 'leads', lead.id, 'followups'));
        batch.set(followupRef, {
          date: serverTimestamp(),
          remark: `System reallocated lead from ${reallocateEmployee.name} (${pendingRole}) to ${newAssigneeName}`,
          employeeId: user.uid
        });

        // Notify new assignee
        const notifRef = doc(collection(db, 'notifications'));
        batch.set(notifRef, {
          userId: newAssigneeId,
          title: 'Transferred Lead Assigned',
          message: `Lead "${lead.name}" was transferred to you due to member status change.`,
          leadId: lead.id,
          read: false,
          createdAt: serverTimestamp()
        });
      });

      // Finally update user role
      batch.update(doc(db, 'users', reallocateEmployee.uid), { 
        role: pendingRole,
        updatedAt: serverTimestamp()
      });
      batch.delete(doc(db, 'employeeDirectory', reallocateEmployee.uid));

      await batch.commit();
      setShowReallocateModal(false);
      setReallocateEmployee(null);
      alert(`Successfully reallocated ${reallocateLeadsCount} leads and updated status.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Allocation failed');
    } finally {
      setLoading(false);
    }
  };

  const checkAndPromptReallocation = (emp: User, newRole: 'suspended' | 'deleted') => {
    const assignedLeadsCount = leads.filter(l => l.assignedTo === emp.uid).length;
    if (assignedLeadsCount > 0) {
      setReallocateEmployee(emp);
      setReallocateLeadsCount(assignedLeadsCount);
      setPendingRole(newRole);
      setShowReallocateModal(true);
      return true; 
    }
    return false;
  };

  const handleTransfer = async (targetEmployee: User) => {
    if (!selectedLead) return;
    if (!confirm(`Transfer lead to ${targetEmployee.name}?`)) return;
    setLoading(true);

    try {
      const leadRef = doc(db, 'leads', selectedLead.id);
      await updateDoc(leadRef, {
        assignedTo: targetEmployee.uid,
        updatedAt: serverTimestamp()
      });

      await addDoc(collection(db, 'leads', selectedLead.id, 'followups'), {
        date: serverTimestamp(),
        remark: `Admin transferred lead from ${employees.find(e => e.uid === selectedLead.assignedTo)?.name || 'Unknown'} to ${targetEmployee.name}`,
        employeeId: user.uid
      });

      // Notify new assignee
      await addDoc(collection(db, 'notifications'), {
        userId: targetEmployee.uid,
        title: 'New Lead Assigned',
        message: `Admin re-assigned lead "${selectedLead.name}" to you.`,
        leadId: selectedLead.id,
        read: false,
        createdAt: serverTimestamp()
      });

      setShowTransferModal(false);
      setSelectedLead(null);
      alert(`Lead successfully transferred to ${targetEmployee.name}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `leads/${selectedLead.id}`);
    } finally {
      setLoading(false);
    }
  };

  const handleInteraction = async (status: LeadStatus) => {
    if (!selectedLead) return;
    if (!interactionRemark) return alert('Remark is mandatory for recording an interaction');
    setLoading(true);

    try {
      const leadRef = doc(db, 'leads', selectedLead.id);
      const updateData: any = {
        status,
        lastRemark: interactionRemark,
        updatedAt: serverTimestamp(),
        lastInteractionAt: serverTimestamp(),
      };

      const localUpdateData: Partial<Lead> = {
        status,
        lastRemark: interactionRemark,
        updatedAt: Timestamp.now(),
        lastInteractionAt: Timestamp.now(),
      };

      if (nextFollowupDate && !isNaN(new Date(nextFollowupDate).getTime())) {
        const nextFollowupAt = Timestamp.fromDate(new Date(nextFollowupDate));
        updateData.nextFollowupAt = nextFollowupAt;
        localUpdateData.nextFollowupAt = nextFollowupAt;
      }

      await updateDoc(leadRef, updateData);

      await addDoc(collection(db, 'leads', selectedLead.id, 'followups'), {
        date: serverTimestamp(),
        remark: `[Admin] ${interactionRemark}`,
        employeeId: user.uid
      });

      // Notify assigned employee about admin remark
      if (selectedLead.assignedTo) {
        await addDoc(collection(db, 'notifications'), {
          userId: selectedLead.assignedTo,
          title: 'Admin Remark Added',
          message: `Admin added a remark on your lead "${selectedLead.name}": ${interactionRemark}`,
          leadId: selectedLead.id,
          read: false,
          createdAt: serverTimestamp()
        });
      }

      setInteractionRemark('');
      setNextFollowupDate('');
      // Update local state with concrete timestamps to avoid invalid date formatting crashes.
      setSelectedLead((prev) => (prev ? ({ ...prev, ...localUpdateData } as Lead) : prev));

      let successMessage = 'Interaction recorded successfully.';
      if (status === 'interested' || status === 'interest') {
        successMessage = 'Interested successfully.';
      } else if (status === 'not_interested') {
        successMessage = 'Declined successfully.';
      }

      alert(successMessage);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `leads/${selectedLead.id}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const qEmployees = query(collection(db, 'users'), where('role', 'in', ['employee', 'suspended', 'deleted']));
    const unsubscribeEmployees = onSnapshot(qEmployees, (snapshot) => {
      setEmployees(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as User)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));

    const qLeads = query(collection(db, 'leads'), orderBy('createdAt', 'desc'));
    const unsubscribeLeads = onSnapshot(qLeads, (snapshot) => {
      setLeads(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Lead)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'leads'));

    const qAttendance = query(collection(db, 'attendance'), orderBy('timestamp', 'desc'), limit(100));
    const unsubscribeAttendance = onSnapshot(qAttendance, (snapshot) => {
      setAttendance(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'attendance'));

    const qReqs = query(collection(db, 'requirements'), orderBy('createdAt', 'desc'));
    const unsubscribeReqs = onSnapshot(qReqs, (snapshot) => {
      setRequirements(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Requirement)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'requirements'));

    return () => {
      unsubscribeEmployees();
      unsubscribeLeads();
      unsubscribeAttendance();
      unsubscribeReqs();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (saveToastTimerRef.current) {
        clearTimeout(saveToastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!backSignal || backSignal === processedBackSignalRef.current) {
      return;
    }
    processedBackSignalRef.current = backSignal;

    if (showTransferModal) {
      setShowTransferModal(false);
      return;
    }

    if (showReallocateModal) {
      setShowReallocateModal(false);
      setReallocateEmployee(null);
      return;
    }

    if (showAddLead) {
      setShowAddLead(false);
      return;
    }

    if (showAddEmployee) {
      setShowAddEmployee(false);
      return;
    }

    if (showEditEmployee) {
      setShowEditEmployee(null);
      return;
    }

    if (selectedLead) {
      setSelectedLead(null);
      setIsEditing(false);
      return;
    }

    if (activeView !== 'leads') {
      setActiveView('leads');
    }
  }, [backSignal]);

  useEffect(() => {
    const el = tabsScrollRef.current;
    if (!el) return;

    const updateScrollState = () => {
      setCanScrollTabsLeft(el.scrollLeft > 4);
      setCanScrollTabsRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };

    updateScrollState();
    el.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('resize', updateScrollState);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
    };
  }, []);

  const scrollTabs = (direction: 'left' | 'right') => {
    const el = tabsScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === 'left' ? -180 : 180, behavior: 'smooth' });
  };

  const deleteRequirement = async (reqId: string) => {
    if (!confirm('Are you sure you want to delete this requirement?')) return;
    try {
      await deleteDoc(doc(db, 'requirements', reqId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `requirements/${reqId}`);
    }
  };

  const [filter, setFilter] = useState<LeadStatus | 'total'>('total');
  const [leadSearchQuery, setLeadSearchQuery] = useState('');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Lead>>({});

  const handleUpdateEmployee = async (e: FormEvent) => {
    e.preventDefault();
    if (!showEditEmployee) return;
    
    const currentUser = employees.find(e => e.uid === showEditEmployee.uid);
    const isStatusWorsening = (showEditEmployee.role === 'suspended' || showEditEmployee.role === 'deleted') && 
                             (currentUser?.role !== showEditEmployee.role);
    
    if (isStatusWorsening) {
      const interrupted = checkAndPromptReallocation(showEditEmployee, showEditEmployee.role as any);
      if (interrupted) {
         setShowEditEmployee(null);
         return;
      }
    }

    setLoading(true);
    try {
      await updateDoc(doc(db, 'users', showEditEmployee.uid), {
        name: showEditEmployee.name,
        phone: showEditEmployee.phone,
        role: showEditEmployee.role, // Allow restoring deleted
        updatedAt: serverTimestamp(),
      });

      if (showEditEmployee.role === 'employee') {
        await setDoc(doc(db, 'employeeDirectory', showEditEmployee.uid), {
          name: showEditEmployee.name,
          phone: showEditEmployee.phone,
          role: 'employee',
          updatedAt: serverTimestamp(),
        });
      } else {
        await deleteDoc(doc(db, 'employeeDirectory', showEditEmployee.uid));
      }

      setShowEditEmployee(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${showEditEmployee.uid}`);
    } finally {
      setLoading(false);
    }
  };

  const stats = {
    total: leads.length,
    interested: leads.filter(l => l.status === 'interest' || l.status === 'interested').length,
    notInterested: leads.filter(l => l.status === 'not_interested').length,
    pending: leads.filter(l => l.status === 'pending').length,
    dealPending: leads.filter(l => l.status === 'deal_pending').length,
    dealsApproved: leads.filter(l => l.status === 'deal_approved').length
  };

  const statusFilteredLeads = filter === 'total' 
    ? leads 
    : leads.filter(l => {
        if (filter === 'deal_pending') return l.status === 'deal_pending';
        if (filter === 'deal_approved') return l.status === 'deal_approved';
        return l.status === filter;
      });

  const adminLeadSearchTerm = leadSearchQuery.trim().toLowerCase();
  const filteredLeads = statusFilteredLeads.filter((l) => {
    if (!adminLeadSearchTerm) return true;
    const assignedName = employees.find(e => e.uid === l.assignedTo)?.name || '';
    const searchableText = [
      l.name,
      l.phone,
      l.source,
      l.status?.replace('_', ' '),
      l.addedByName,
      l.lastRemark,
      assignedName
    ].filter(Boolean).join(' ').toLowerCase();
    return searchableText.includes(adminLeadSearchTerm);
  });

  const deleteEmployee = async (empId: string) => {
    const emp = employees.find(e => e.uid === empId);
    if (!emp) return;
    if (!confirm('Are you sure? This will mark the employee as deleted.')) return;
    
    const interrupted = checkAndPromptReallocation(emp, 'deleted');
    if (interrupted) return;

    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', empId), { role: 'deleted', updatedAt: serverTimestamp() });
      batch.delete(doc(db, 'employeeDirectory', empId));
      await batch.commit();
    } catch (error) {
       handleFirestoreError(error, OperationType.UPDATE, `users/${empId}`);
    }
  };

  const handleAddLead = async (e: FormEvent) => {
    e.preventDefault();
    const normalizedLeadPhone = normalizePhone(leadForm.phone);
    if (!normalizedLeadPhone || !leadForm.source) return alert('Phone and Source are mandatory');
    if (normalizedLeadPhone.length !== 10) return alert('Mobile number must be exactly 10 digits.');
    setLoading(true);

    try {
      const activeEmployees = employees.filter(e => e.role === 'employee');
      if (activeEmployees.length === 0) {
        throw new Error('No active employees available for allocation. Add or activate an employee first.');
      }

      if (leadAllocationMode === 'manual') {
        if (!manualLeadAssigneeId) {
          throw new Error('Select an active employee for manual allocation.');
        }

        const assignedEmployee = activeEmployees.find(e => e.uid === manualLeadAssigneeId);
        if (!assignedEmployee) {
          throw new Error('Selected employee is not active. Please choose another employee.');
        }

        await addDoc(collection(db, 'leads'), {
          name: leadForm.name || 'Anonymous',
          phone: normalizedLeadPhone,
          source: leadForm.source,
          status: 'pending',
          assignedTo: assignedEmployee.uid,
          addedById: user.uid,
          addedByName: user.name,
          addedByRole: 'admin',
          assignedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await runTransaction(db, async (transaction) => {
          const allocationRef = doc(db, 'system', 'allocation');
          const allocationDoc = await transaction.get(allocationRef);
          
          let nextIndex = 0;
          if (allocationDoc.exists()) {
            nextIndex = (allocationDoc.data().lastIndex + 1) % activeEmployees.length;
          }

          const assignedEmployee = activeEmployees[nextIndex];
          
          const newLeadRef = doc(collection(db, 'leads'));
          transaction.set(newLeadRef, {
            name: leadForm.name || 'Anonymous',
            phone: normalizedLeadPhone,
            source: leadForm.source,
            status: 'pending',
            assignedTo: assignedEmployee.uid,
            addedById: user.uid,
            addedByName: user.name,
            addedByRole: 'admin',
            assignedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          transaction.set(allocationRef, { 
            lastIndex: nextIndex,
            updatedAt: serverTimestamp()
          }, { merge: true });
        });
      }

      setLeadForm({ name: '', phone: '', source: '' });
      setLeadAllocationMode('auto');
      setManualLeadAssigneeId('');
      setShowAddLead(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'leads');
    } finally {
      setLoading(false);
    }
  };

  const handleAddEmployee = async (e: FormEvent) => {
    e.preventDefault();
    const name = employeeForm.name.trim();
    const normalizedPhone = normalizePhone(employeeForm.phone);
    const email = `${normalizedPhone}@estatepulse.com`;
    const initialPassword = normalizedPhone;

    if (!name) {
      alert('Employee name is required.');
      return;
    }
    if (normalizedPhone.length < 10 || normalizedPhone.length > 15) {
      alert('Enter a valid mobile number (10 to 15 digits).');
      return;
    }

    setLoading(true);
    let provisionApp: ReturnType<typeof initializeApp> | null = null;
    let provisionAuth: ReturnType<typeof getAuth> | null = null;
    let provisionedUser: { delete: () => Promise<void> } | null = null;
    try {
      // Use a secondary auth instance so the admin session is not replaced.
      provisionApp = initializeApp(firebaseConfig, `employee-provisioner-${Date.now()}`);
      provisionAuth = getAuth(provisionApp);
      const userCredential = await createUserWithEmailAndPassword(provisionAuth, email, initialPassword);
      provisionedUser = userCredential.user;

      const batch = writeBatch(db);
      batch.set(doc(db, 'users', userCredential.user.uid), {
        name,
        email,
        role: 'employee',
        phone: normalizedPhone,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'employeeDirectory', userCredential.user.uid), {
        name,
        phone: normalizedPhone,
        role: 'employee',
        updatedAt: serverTimestamp(),
      });
      await batch.commit();

      showSaveToast(`${name} added successfully`, 'New member added');
      setEmployeeForm({ name: '', phone: '' });
      setShowAddEmployee(false);
    } catch (error) {
      if (provisionedUser) {
        await provisionedUser.delete().catch(() => {});
      }
      handleFirestoreError(error, OperationType.CREATE, 'users');
      const code = typeof error === 'object' && error && 'code' in error ? String((error as any).code) : '';
      if (code === 'auth/email-already-in-use') {
        alert('An employee account with this mobile number already exists.');
      } else if (code === 'auth/weak-password') {
        alert('Unable to set initial password. Please use a valid mobile number.');
      } else if (error instanceof Error) {
        alert(error.message || 'Failed to add employee. Please try again.');
      } else {
        alert('Failed to add employee. Please try again.');
      }
    } finally {
      try {
        if (provisionAuth) {
          await signOut(provisionAuth);
        }
      } catch {
        // Ignore cleanup sign-out failures for secondary auth instance.
      }
      if (provisionApp) {
        await deleteApp(provisionApp).catch(() => {});
      }
      setLoading(false);
    }
  };

  const handleUpdateLead = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'leads', selectedLead.id), {
        ...editForm,
        updatedAt: serverTimestamp()
      });
      setIsEditing(false);
      setSelectedLead({ ...selectedLead, ...editForm } as Lead);
      showSaveToast('Changes saved', 'Lead details updated');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `leads/${selectedLead.id}`);
    } finally {
      setLoading(false);
    }
  };

  const approveDeal = async (leadId: string) => {
    try {
      await updateDoc(doc(db, 'leads', leadId), {
        status: 'deal_approved',
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `leads/${leadId}`);
    }
  };

  const handleVerifySiteVisit = async () => {
    if (!selectedLead || !selectedLead.siteVisitPhoto) return;

    setLoading(true);
    try {
      await updateDoc(doc(db, 'leads', selectedLead.id), {
        siteVisitVerifiedAt: serverTimestamp(),
        siteVisitVerifiedBy: user.name,
        updatedAt: serverTimestamp(),
      });

      await addDoc(collection(db, 'leads', selectedLead.id, 'followups'), {
        date: serverTimestamp(),
        remark: `Admin verified site visit photo and location evidence.`,
        employeeId: user.uid
      });

      setSelectedLead({
        ...selectedLead,
        siteVisitVerifiedAt: Timestamp.now(),
        siteVisitVerifiedBy: user.name,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `leads/${selectedLead.id}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 pb-20">
      {/* Top Navigation / Tabs */}
      <div className="relative mb-8">
        <div
          ref={tabsScrollRef}
          className="flex bg-white/50 p-1.5 rounded-[24px] border border-slate-100 overflow-x-auto no-scrollbar whitespace-nowrap"
        >
        {[
          { id: 'leads', icon: Users, label: 'Leads' },
          { id: 'employees', icon: UserPlus, label: 'Team' },
          { id: 'attendance', icon: Clock, label: 'Attendance' },
          { id: 'requirements', icon: FileText, label: 'Needs' },
          { id: 'inventory', icon: LayoutGrid, label: 'Inventory' }
        ].map(tab => (
          <button 
            key={tab.id}
            onClick={() => setActiveView(tab.id as any)}
            className={cn(
              "min-w-[140px] md:min-w-0 md:flex-1 flex items-center justify-center gap-3 py-3.5 px-6 rounded-2xl text-xs font-black uppercase tracking-widest transition-all",
              activeView === tab.id 
                ? "bg-slate-900 text-white shadow-xl shadow-slate-200" 
                : "text-slate-400 hover:text-slate-600 hover:bg-white"
            )}
          >
            <tab.icon size={16} /> {tab.label}
          </button>
        ))}
        </div>
        <button
          type="button"
          onClick={() => scrollTabs('left')}
          className={cn(
            "md:hidden absolute left-1 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-white/95 border border-slate-200 shadow-sm flex items-center justify-center text-slate-500 transition-all",
            canScrollTabsLeft ? "opacity-100" : "opacity-30 pointer-events-none"
          )}
          aria-label="Scroll tabs left"
          title="Scroll tabs left"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          onClick={() => scrollTabs('right')}
          className={cn(
            "md:hidden absolute right-1 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-white/95 border border-slate-200 shadow-sm flex items-center justify-center text-slate-500 transition-all",
            canScrollTabsRight ? "opacity-100" : "opacity-30 pointer-events-none"
          )}
          aria-label="Scroll tabs right"
          title="Scroll tabs right"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-4 sm:p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Database size={18} className="text-blue-600" />
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider">Admin Data Tools</h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-100 p-4 space-y-3">
            <p className="text-xs font-black uppercase tracking-widest text-gray-500">Leads Database</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={Boolean(dataToolsBusy)}
                onClick={exportLeadsData}
                className="px-3 py-2 rounded-lg bg-blue-50 text-blue-700 text-xs font-black uppercase tracking-wider hover:bg-blue-100 transition-colors disabled:opacity-40"
              >
                <span className="inline-flex items-center gap-1.5"><Download size={14} /> Export</span>
              </button>
              <button
                type="button"
                disabled={Boolean(dataToolsBusy)}
                onClick={() => leadsImportInputRef.current?.click()}
                className="px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-black uppercase tracking-wider hover:bg-emerald-100 transition-colors disabled:opacity-40"
              >
                <span className="inline-flex items-center gap-1.5"><Upload size={14} /> Import</span>
              </button>
              <button
                type="button"
                disabled={Boolean(dataToolsBusy)}
                onClick={clearEntireLeads}
                className="px-3 py-2 rounded-lg bg-rose-50 text-rose-700 text-xs font-black uppercase tracking-wider hover:bg-rose-100 transition-colors disabled:opacity-40"
              >
                <span className="inline-flex items-center gap-1.5"><Trash2 size={14} /> Clear All</span>
              </button>
            </div>
            <input
              ref={leadsImportInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) await importDataFile('leads', file);
                e.currentTarget.value = '';
              }}
            />
          </div>

          <div className="rounded-xl border border-gray-100 p-4 space-y-3">
            <p className="text-xs font-black uppercase tracking-widest text-gray-500">Inventory Database</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={Boolean(dataToolsBusy)}
                onClick={exportInventoryData}
                className="px-3 py-2 rounded-lg bg-blue-50 text-blue-700 text-xs font-black uppercase tracking-wider hover:bg-blue-100 transition-colors disabled:opacity-40"
              >
                <span className="inline-flex items-center gap-1.5"><Download size={14} /> Export</span>
              </button>
              <button
                type="button"
                disabled={Boolean(dataToolsBusy)}
                onClick={() => inventoryImportInputRef.current?.click()}
                className="px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-black uppercase tracking-wider hover:bg-emerald-100 transition-colors disabled:opacity-40"
              >
                <span className="inline-flex items-center gap-1.5"><Upload size={14} /> Import</span>
              </button>
              <button
                type="button"
                disabled={Boolean(dataToolsBusy)}
                onClick={clearEntireInventory}
                className="px-3 py-2 rounded-lg bg-rose-50 text-rose-700 text-xs font-black uppercase tracking-wider hover:bg-rose-100 transition-colors disabled:opacity-40"
              >
                <span className="inline-flex items-center gap-1.5"><Trash2 size={14} /> Clear All</span>
              </button>
            </div>
            <input
              ref={inventoryImportInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) await importDataFile('inventory', file);
                e.currentTarget.value = '';
              }}
            />
          </div>
        </div>
        {dataToolsBusy && (
          <p className="mt-3 text-[11px] font-bold text-blue-600 uppercase tracking-widest">
            Processing: {dataToolsBusy.replace('_', ' ')}
          </p>
        )}
      </div>

      {activeView === 'leads' ? (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {[
          { label: 'Total Leads', id: 'total', value: stats.total, icon: ClipboardList, color: 'bg-blue-500' },
          { label: 'Interested', id: 'interested', value: stats.interested, icon: CheckCircle2, color: 'bg-green-500' },
          { label: 'Not Interested', id: 'not_interested', value: stats.notInterested, icon: XCircle, color: 'bg-red-500' },
          { label: 'Pending', id: 'pending', value: stats.pending, icon: Clock, color: 'bg-orange-500' },
          { label: 'Deals Pending', id: 'deal_pending', value: stats.dealPending, icon: ShieldCheck, color: 'bg-purple-500' },
          { label: 'Deals Approved', id: 'deal_approved', value: stats.dealsApproved, icon: CheckCircle2, color: 'bg-indigo-600' }
        ].map((stat, i) => (
          <button 
            key={i} 
            onClick={() => setFilter(stat.id as any)}
            className={cn(
              "bg-white p-4 rounded-2xl shadow-sm border transition-all text-left group",
              filter === stat.id ? "border-blue-500 ring-4 ring-blue-50" : "border-gray-100 hover:border-blue-200"
            )}
          >
            <div className={cn("w-10 h-10 rounded-xl mb-3 flex items-center justify-center text-white", stat.color)}>
              <stat.icon size={20} />
            </div>
            <p className="text-[10px] font-black uppercase text-gray-400 tracking-tighter">{stat.label}</p>
            <p className="text-2xl font-bold text-gray-900 group-hover:scale-110 origin-left transition-transform">{stat.value}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Leads List */}
        <div className="flex-1 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              {filter === 'total' ? 'All' : filter.replace('_', ' ').toUpperCase()} Leads
              <span className="text-sm font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{filteredLeads.length}</span>
            </h2>
            <div className="flex gap-2">
              <button 
                onClick={() => {
                  if (employees.length === 0) {
                    alert('Please add at least one employee first to enable lead allocation.');
                    return;
                  }
                  setLeadAllocationMode('auto');
                  setManualLeadAssigneeId('');
                  setShowAddLead(true);
                }}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-md active:scale-95",
                  employees.length === 0 
                  ? "bg-gray-400 cursor-not-allowed text-white" 
                  : "bg-blue-600 hover:bg-blue-700 text-white"
                )}
                title={employees.length === 0 ? "Add an employee first" : "Add new client"}
              >
                <Plus size={18} />
                Add Lead
              </button>
            </div>
          </div>
          <div className="relative">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={leadSearchQuery}
              onChange={e => setLeadSearchQuery(e.target.value)}
              placeholder="Search leads by name, number, source, assignee..."
              className="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 placeholder:text-gray-400 focus:ring-4 focus:ring-blue-100 focus:border-blue-300 outline-none"
            />
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Client</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Source</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Added By</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Assigned To</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Last Follow-up</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredLeads.map((lead) => (
                    <tr 
                      key={lead.id} 
                      onClick={() => { setSelectedLead(lead); setEditForm(lead); }}
                      className="hover:bg-gray-50/50 transition-colors cursor-pointer group"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs">
                            {lead.name[0]}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">{lead.name}</p>
                            <p className="text-sm text-gray-500">{lead.phone}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-md uppercase tracking-tighter">
                          {lead.source}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-medium text-gray-600 bg-gray-100 px-2.5 py-1 rounded-lg">
                          {lead.addedByName || (lead.addedByRole === 'admin' ? 'Admin' : 'Legacy')}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-medium text-gray-600 bg-gray-100 px-2.5 py-1 rounded-lg">
                          {employees.find(e => e.uid === lead.assignedTo)?.name || 'Unknown'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {lead.lastInteractionAt ? (
                          <div className="flex items-center gap-1.5">
                            <History size={12} className="text-blue-400" />
                            <p className="text-[10px] font-bold text-gray-600 uppercase tracking-tighter">
                              {formatLeadDate(lead.lastInteractionAt)}
                            </p>
                          </div>
                        ) : (
                          <span className="text-[10px] font-bold text-gray-300 uppercase italic">Never</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div 
                          title={`Last updated: ${formatLeadDate(lead.updatedAt || lead.createdAt)}`}
                          className={cn(
                          "inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold uppercase",
                          lead.status === 'pending' && "bg-orange-100 text-orange-600",
                          lead.status === 'interested' && "bg-green-100 text-green-600",
                          lead.status === 'not_interested' && "bg-red-100 text-red-600",
                          lead.status === 'deal_pending' && "bg-purple-100 text-purple-600",
                          lead.status === 'deal_approved' && "bg-blue-100 text-blue-600",
                        )}>
                          {lead.status.replace('_', ' ')}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {lead.status === 'deal_pending' && (
                          <button 
                            onClick={() => approveDeal(lead.id)}
                            className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95"
                          >
                            Approve Deal
                          </button>
                        )}
                        {lead.status === 'deal_approved' && (
                          <span className="text-green-600 flex items-center justify-end gap-1 font-bold text-xs">
                            <CheckCircle2 size={14} /> Approved
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredLeads.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-400 font-medium">
                        No leads found in this category.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
    ) : activeView === 'attendance' ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900">Live Attendance Logs</h2>
            <p className="text-sm text-gray-500 font-medium bg-gray-100 px-3 py-1 rounded-full">Real-time Location Based tracking</p>
          </div>

          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-400 tracking-widest">Employee</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-400 tracking-widest">Action</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-400 tracking-widest">Timestamp</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-400 tracking-widest">Location</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {attendance.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <p className="font-bold text-gray-900">{log.employeeName}</p>
                        <p className="text-xs text-gray-400">{log.uid.slice(-6)}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase",
                          log.type === 'clock_in' ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"
                        )}>
                          {log.type.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium text-gray-700">{log.timestamp ? format(log.timestamp.toDate(), 'PPP') : 'Just now'}</p>
                        <p className="text-xs text-gray-500">{log.timestamp ? format(log.timestamp.toDate(), 'p') : ''}</p>
                      </td>
                      <td className="px-6 py-4">
                        <a 
                          href={`https://www.google.com/maps?q=${log.location.latitude},${log.location.longitude}`} 
                          target="_blank" 
                          rel="noreferrer"
                          className="flex items-center gap-2 text-xs font-bold text-blue-600 hover:underline"
                        >
                          <History size={14} /> View Location
                        </a>
                      </td>
                    </tr>
                  ))}
                  {attendance.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-gray-400 font-medium italic">
                        No attendance records yet today.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : activeView === 'employees' ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Team</h2>
              <p className="text-xs text-gray-500 mt-1">
                New employees are added directly. Initial password is set to their mobile number.
              </p>
            </div>
            <button 
              onClick={() => setShowAddEmployee(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-2xl font-bold transition-all shadow-lg active:scale-95"
            >
              <UserPlus size={20} /> Add New Member
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {employees.map((emp) => (
              <motion.div 
                key={emp.uid} 
                layout
                className={cn(
                  "bg-white p-6 rounded-3xl border shadow-sm flex items-start gap-4 transition-all hover:shadow-md",
                  (emp.role === 'deleted' || emp.role === 'suspended') ? "opacity-60 border-red-100 bg-red-50/20" : "border-gray-100"
                )}
              >
                <div className={cn(
                  "w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold shadow-inner",
                  emp.role === 'deleted' ? "bg-gray-200 text-gray-500" : "bg-blue-600 text-white"
                )}>
                  {emp.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-gray-900 truncate text-lg">{emp.name}</p>
                    <span className={cn(
                      "text-[10px] uppercase font-black px-2 py-0.5 rounded-md",
                      emp.role === 'deleted' ? "bg-red-100 text-red-600" : 
                      emp.role === 'suspended' ? "bg-orange-100 text-orange-600" :
                      "bg-green-100 text-green-600"
                    )}>
                      {emp.role}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 font-medium">{emp.phone}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{emp.email}</p>
                  
                  <div className="flex gap-2 mt-4">
                    <button 
                      onClick={() => setShowEditEmployee(emp)}
                      className="flex-1 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-xl text-xs font-bold border border-gray-200 transition-colors"
                    >
                      Edit Profile
                    </button>
                    {emp.role !== 'deleted' ? (
                      <button 
                        onClick={() => deleteEmployee(emp.uid)}
                        className="py-2 px-3 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl transition-colors border border-red-100"
                        title="Delete Employee"
                      >
                        <XCircle size={16} />
                      </button>
                    ) : (
                      <button 
                        onClick={() => updateDoc(doc(db, 'users', emp.uid), { role: 'employee' })}
                        className="py-2 px-3 bg-green-50 hover:bg-green-100 text-green-600 rounded-xl transition-colors border border-green-100"
                        title="Restore Employee"
                      >
                        <CheckCircle2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
            {employees.length === 0 && (
              <div className="col-span-full py-20 text-center bg-gray-50 rounded-3xl border border-dashed border-gray-200">
                <Users size={48} className="mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500 font-bold">No employees found.</p>
                <p className="text-xs text-gray-400 mt-1">Add your first team member to start allocations.</p>
                <button onClick={() => setShowAddEmployee(true)} className="text-blue-600 text-sm font-bold mt-2 hover:underline">Add employee</button>
              </div>
            )}
          </div>
        </div>
      ) : activeView === 'requirements' ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <FileText className="text-blue-600" size={28} /> Client Requirements
            </h2>
            <p className="text-[10px] font-black text-slate-400 capitalize px-4 py-1.5 bg-slate-100 rounded-full tracking-widest">
              Total Recorded: {requirements.length}
            </p>
          </div>

          <div className="bg-white rounded-[32px] border border-slate-100 shadow-xl shadow-slate-200/20 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-8 py-5 text-[10px] font-black uppercase text-slate-400 tracking-widest">Client Details</th>
                    <th className="px-8 py-5 text-[10px] font-black uppercase text-slate-400 tracking-widest">Type</th>
                    <th className="px-8 py-5 text-[10px] font-black uppercase text-slate-400 tracking-widest">Budget/Area</th>
                    <th className="px-8 py-5 text-[10px] font-black uppercase text-slate-400 tracking-widest">Location</th>
                    <th className="px-8 py-5 text-[10px] font-black uppercase text-slate-400 tracking-widest">Employee</th>
                    <th className="px-8 py-5 text-[10px] font-black uppercase text-slate-400 tracking-widest text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {requirements.map((req) => (
                    <tr key={req.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-black text-lg group-hover:bg-blue-600 group-hover:text-white transition-all">
                            {req.name[0]}
                          </div>
                          <div>
                            <p className="font-black text-slate-900">{req.name}</p>
                            <p className="text-xs text-slate-400 font-bold flex items-center gap-1">
                              <Phone size={12} /> {req.phone}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <span className="px-3 py-1 bg-slate-900 text-white text-[9px] font-black uppercase rounded-full tracking-widest">
                          {req.type}
                        </span>
                      </td>
                      <td className="px-8 py-6">
                        <div>
                          <p className="text-xs font-black text-slate-700 leading-tight">₹ {req.budget || 'N/A'}</p>
                          <p className="text-[10px] text-slate-400 font-bold">{req.area || 'N/A'}</p>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-1.5 text-xs text-slate-600 font-bold">
                          <MapPin size={14} className="text-blue-500" />
                          {req.location || 'N/A'}
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <p className="text-xs font-black text-slate-700">{req.employeeName}</p>
                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                          {req.createdAt ? format(req.createdAt.toDate(), 'MMM dd, h:mm a') : 'Recently'}
                        </p>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <button 
                          onClick={() => deleteRequirement(req.id)}
                          className="w-10 h-10 rounded-xl bg-slate-50 text-slate-300 hover:bg-rose-50 hover:text-rose-600 transition-all flex items-center justify-center shadow-inner"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {requirements.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-8 py-20 text-center">
                        <div className="w-20 h-20 bg-slate-50 text-slate-200 rounded-full flex items-center justify-center mx-auto mb-4">
                          <FileText size={40} />
                        </div>
                        <p className="text-slate-400 font-black text-xs uppercase tracking-[0.2em]">No Requirements Recorded</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : activeView === 'inventory' ? (
        <InventoryManagement user={user} />
      ) : null}

      {/* Reallocate Leads Modal */}
      {showReallocateModal && reallocateEmployee && (
        <div className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-lg bg-white rounded-[40px] overflow-hidden shadow-2xl flex flex-col"
          >
            <div className="p-8 border-b border-gray-100 bg-orange-50/50">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-14 h-14 rounded-2xl bg-orange-500 text-white flex items-center justify-center shadow-lg shadow-orange-200">
                  <ArrowLeftRight size={28} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-gray-900 tracking-tight">Reallocate Leads</h3>
                  <p className="text-sm text-gray-500 font-medium">{reallocateEmployee.name} has {reallocateLeadsCount} active leads</p>
                </div>
              </div>
              <p className="text-sm text-orange-700 bg-orange-100/50 p-4 rounded-2xl font-medium border border-orange-200">
                You must reassign these leads before changing the member's status to <strong>{pendingRole}</strong>.
              </p>
            </div>

            <div className="p-8 space-y-6">
              <div className="space-y-4">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Allocation Method</label>
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => setReallocateToMethod('auto')}
                    className={cn(
                      "p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-2",
                      reallocateToMethod === 'auto' ? "border-blue-500 bg-blue-50/50" : "border-gray-100 hover:border-gray-200"
                    )}
                  >
                    <Users size={20} className={reallocateToMethod === 'auto' ? "text-blue-600" : "text-gray-400"} />
                    <span className="font-bold text-sm">Automatic</span>
                  </button>
                  <button 
                    onClick={() => setReallocateToMethod('manual')}
                    className={cn(
                      "p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-2",
                      reallocateToMethod === 'manual' ? "border-blue-500 bg-blue-50/50" : "border-gray-100 hover:border-gray-200"
                    )}
                  >
                    <UserPlus size={20} className={reallocateToMethod === 'manual' ? "text-blue-600" : "text-gray-400"} />
                    <span className="font-bold text-sm">To Person</span>
                  </button>
                </div>
              </div>

              {reallocateToMethod === 'manual' && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Select Target Recipient</label>
                  <select 
                    value={targetEmployeeId}
                    onChange={e => setTargetEmployeeId(e.target.value)}
                    className="w-full px-6 py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-4 focus:ring-blue-100 outline-none font-bold text-gray-700"
                  >
                    <option value="">-- Choose Employee --</option>
                    {employees
                      .filter(e => e.uid !== reallocateEmployee.uid && e.role === 'employee')
                      .map(e => <option key={e.uid} value={e.uid}>{e.name} ({leads.filter(l => l.assignedTo === e.uid).length} leads)</option>)}
                  </select>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => { setShowReallocateModal(false); setReallocateEmployee(null); }}
                  className="flex-1 py-4 font-bold text-gray-500 bg-gray-50 rounded-2xl hover:bg-gray-100 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleReallocateAndChangeStatus}
                  disabled={loading || (reallocateToMethod === 'manual' && !targetEmployeeId)}
                  className="flex-[2] py-4 bg-blue-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl shadow-blue-200 hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-30"
                >
                  {loading ? 'Reallocating...' : `Confirm & Reallocate ${reallocateLeadsCount} Leads`}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Lead Detail & Edit Modal */}
      {selectedLead && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, y: 30 }} 
            animate={{ opacity: 1, y: 0 }} 
            className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
          >
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white font-bold text-xl">
                  {selectedLead.name[0]}
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{selectedLead.name}</h3>
                  <p className="text-sm text-gray-500">{selectedLead.phone}</p>
                </div>
              </div>
              <button onClick={() => { setSelectedLead(null); setIsEditing(false); }} className="p-2 hover:bg-red-100 rounded-full text-gray-400 hover:text-red-500 transition-colors">
                <XCircle size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8">
              {!isEditing ? (
                <div className="space-y-8">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Status</p>
                      <p className={cn("text-lg font-bold", 
                        selectedLead.status === 'interested' ? "text-green-600" :
                        selectedLead.status === 'deal_pending' ? "text-purple-600" :
                        selectedLead.status === 'deal_approved' ? "text-blue-600" : "text-gray-900"
                      )}>
                        {selectedLead.status.replace('_', ' ').toUpperCase()}
                      </p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Lead Source</p>
                      <p className="text-lg font-bold text-gray-900 uppercase">
                        {selectedLead.source}
                      </p>
                    </div>
                    {selectedLead.lastInteractionAt && (
                      <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 col-span-2 shadow-inner">
                        <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-1 flex items-center gap-2">
                          <History size={12} /> Last Follow-up Interaction
                        </p>
                        <p className="text-sm font-bold text-blue-700">
                          {formatLeadDate(selectedLead.lastInteractionAt)}
                        </p>
                      </div>
                    )}
                    <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 relative group">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Assigned To</p>
                      <div className="flex items-center justify-between">
                        <p className="text-lg font-bold text-gray-900">
                          {employees.find(e => e.uid === selectedLead.assignedTo)?.name || 'Unknown'}
                        </p>
                        <button 
                          onClick={() => setShowTransferModal(true)}
                          className="p-1.5 bg-orange-50 text-orange-600 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-orange-100"
                        >
                          <ArrowLeftRight size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Added By</p>
                      <p className="text-lg font-bold text-gray-900">
                        {selectedLead.addedByName || (selectedLead.addedByRole === 'admin' ? 'Admin' : 'Legacy')}
                      </p>
                    </div>
                  </div>

                  {/* Quick Interaction Panel for Admin */}
                  <div className="space-y-4 p-6 bg-blue-50/30 rounded-[32px] border border-blue-100/50">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-gray-900 flex items-center gap-2">
                        <MessageSquare className="text-blue-500" size={20} /> Quick Interaction
                      </h4>
                    </div>
                    <div className="space-y-4">
                      <textarea
                        placeholder="Add a remark as Admin..."
                        value={interactionRemark}
                        onChange={e => setInteractionRemark(e.target.value)}
                        className="w-full h-24 px-4 py-3 bg-white border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all resize-none font-medium text-sm"
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Next Followup</label>
                          <input
                            type="date"
                            value={nextFollowupDate}
                            onChange={e => setNextFollowupDate(e.target.value)}
                            className="px-4 py-2 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium h-[42px]"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Quick Status</label>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => handleInteraction('interested')}
                              disabled={loading || !interactionRemark}
                              className="flex-1 bg-green-600 text-white font-bold rounded-xl text-xs hover:bg-green-700 shadow-md transition-all active:scale-95 disabled:opacity-50 h-[42px]"
                            >
                              Interested
                            </button>
                            <button 
                              onClick={() => handleInteraction('not_interested')}
                              disabled={loading || !interactionRemark}
                              className="flex-1 bg-red-600 text-white font-bold rounded-xl text-xs hover:bg-red-700 shadow-md transition-all active:scale-95 disabled:opacity-50 h-[42px]"
                            >
                              Declined
                            </button>
                          </div>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleInteraction(selectedLead.status)}
                        disabled={loading || !interactionRemark}
                        className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl text-sm shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all disabled:opacity-50 active:scale-95 flex items-center justify-center gap-2"
                      >
                        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                        Update Remark {nextFollowupDate && '& Schedule'}
                      </button>
                    </div>
                  </div>

                  {selectedLead.siteVisitPhoto && (
                    <div className="space-y-4 p-6 bg-violet-50/40 rounded-[32px] border border-violet-100">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="font-bold text-gray-900 flex items-center gap-2">
                          <MapPin className="text-violet-500" size={20} /> Site Visit Verification
                        </h4>
                        {selectedLead.siteVisitVerifiedAt ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 text-green-700 text-[10px] font-black uppercase tracking-widest">
                            <CheckCircle2 size={12} /> Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-widest">
                            Pending Verify
                          </span>
                        )}
                      </div>

                      <a
                        href={selectedLead.siteVisitPhoto}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-2xl overflow-hidden border border-violet-100 shadow-sm bg-white"
                        title="Open full image"
                      >
                        <img
                          src={selectedLead.siteVisitPhoto}
                          alt="Site visit evidence"
                          className="w-full h-64 object-cover hover:scale-[1.01] transition-transform"
                          referrerPolicy="no-referrer"
                        />
                      </a>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="p-3 bg-white rounded-xl border border-violet-100">
                          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Captured At</p>
                          <p className="text-sm font-bold text-gray-800">
                            {selectedLead.siteVisitAt ? formatLeadDate(selectedLead.siteVisitAt) : 'Not available'}
                          </p>
                        </div>
                        <div className="p-3 bg-white rounded-xl border border-violet-100">
                          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">GPS Coordinates</p>
                          <p className="text-sm font-bold text-gray-800 break-all">
                            {selectedLead.siteVisitLocation
                              ? `${selectedLead.siteVisitLocation.latitude.toFixed(6)}, ${selectedLead.siteVisitLocation.longitude.toFixed(6)}`
                              : 'Not available'}
                          </p>
                        </div>
                      </div>

                      {selectedLead.siteVisitVerifiedAt ? (
                        <p className="text-xs font-semibold text-green-700 bg-green-50 border border-green-100 rounded-xl px-3 py-2">
                          Verified by {selectedLead.siteVisitVerifiedBy || 'Admin'} on {formatLeadDate(selectedLead.siteVisitVerifiedAt)}.
                        </p>
                      ) : (
                        <button
                          onClick={handleVerifySiteVisit}
                          disabled={loading}
                          className="w-full py-3 bg-violet-600 text-white font-bold rounded-xl shadow-lg shadow-violet-100 hover:bg-violet-700 transition-all active:scale-95 disabled:opacity-50"
                        >
                          {loading ? 'Verifying...' : 'Verify Site Visit Evidence'}
                        </button>
                      )}
                    </div>
                  )}

                  <div className="space-y-3">
                    <h4 className="font-bold text-gray-900 flex items-center gap-2">
                       <History size={18} className="text-gray-400" /> Interaction Timeline
                    </h4>
                    <div className="space-y-4">
                       <LeadTimeline leadId={selectedLead.id} />
                    </div>
                  </div>

                  <button 
                    onClick={() => setIsEditing(true)}
                    className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-lg hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                  >
                    Edit Everything
                  </button>
                </div>
              ) : (
                <form onSubmit={handleUpdateLead} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Full Name</label>
                      <input required value={editForm.name || ''} onChange={e => setEditForm({...editForm, name: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Mobile</label>
                      <input required value={editForm.phone || ''} onChange={e => setEditForm({...editForm, phone: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Source</label>
                      <input required value={editForm.source || ''} onChange={e => setEditForm({...editForm, source: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. Facebook, Website, Referral" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Update Status</label>
                      <select value={editForm.status || ''} onChange={e => setEditForm({...editForm, status: e.target.value as any})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="pending">Pending</option>
                        <option value="interested">Interested</option>
                        <option value="not_interested">Not Interested</option>
                        <option value="deal_pending">Deal Submitted</option>
                        <option value="deal_approved">Deal Approved</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Re-assign To</label>
                      <select value={editForm.assignedTo || ''} onChange={e => setEditForm({...editForm, assignedTo: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500">
                        {employees.filter(e => e.role === 'employee').map(e => <option key={e.uid} value={e.uid}>{e.name}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-4 border-t border-gray-100">
                    <button type="button" onClick={() => setIsEditing(false)} className="flex-1 py-4 font-bold text-gray-500 bg-gray-100 rounded-2xl hover:bg-gray-200 transition-colors">Cancel</button>
                    <button type="submit" disabled={loading} className="flex-1 py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-xl shadow-blue-200 active:scale-95 transition-all">
                      {loading ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Edit Employee Modal */}
      {showEditEmployee && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-gray-900">Edit Member</h3>
              <button onClick={() => setShowEditEmployee(null)} className="text-gray-400 hover:text-gray-600"><XCircle size={24} /></button>
            </div>
            <form onSubmit={handleUpdateEmployee} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Full Name</label>
                <input 
                  required 
                  value={showEditEmployee.name} 
                  onChange={e => setShowEditEmployee({...showEditEmployee, name: e.target.value})} 
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" 
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Mobile Number</label>
                <input 
                  required 
                  value={showEditEmployee.phone} 
                  onChange={e => setShowEditEmployee({...showEditEmployee, phone: e.target.value})} 
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" 
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Role / Status</label>
                <select 
                  value={showEditEmployee.role} 
                  onChange={e => setShowEditEmployee({...showEditEmployee, role: e.target.value as any})}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="employee">Active Employee</option>
                  <option value="suspended">Suspended</option>
                  <option value="deleted">Deleted (Hard Removal)</option>
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowEditEmployee(null)} className="flex-1 py-3 font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition-colors">Cancel</button>
                <button type="submit" disabled={loading} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-200 active:scale-95 transition-all">
                  {loading ? 'Saving...' : 'Update Member'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Modals */}
      {showTransferModal && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 text-left">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md bg-white rounded-[32px] overflow-hidden shadow-2xl flex flex-col"
          >
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">Admin Re-assign Lead</h3>
              <button onClick={() => setShowTransferModal(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400">
                <XCircle size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="relative">
                <input
                  placeholder="Search employee..."
                  value={transferSearch}
                  onChange={e => setTransferSearch(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                />
              </div>
              <div className="max-h-64 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                {employees
                  .filter(emp => emp.role === 'employee' && emp.name.toLowerCase().includes(transferSearch.toLowerCase()))
                  .map(emp => (
                    <button
                      key={emp.uid}
                      onClick={() => handleTransfer(emp)}
                      className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 hover:border-blue-200 border border-transparent rounded-2xl transition-all group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center font-bold">
                          {emp.name[0]}
                        </div>
                        <div className="text-left">
                          <p className="font-bold text-gray-900">{emp.name}</p>
                          <p className="text-[10px] text-gray-500 font-bold uppercase">{emp.phone}</p>
                        </div>
                      </div>
                      <ArrowLeftRight size={18} className="text-gray-300 group-hover:text-blue-500 transition-colors" />
                    </button>
                  ))}
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {showAddLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/50 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl max-h-[92vh] overflow-y-auto">
            <h3 className="text-2xl font-bold mb-7 text-gray-900">Add New Lead</h3>
            <form onSubmit={handleAddLead} className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Customer Name</label>
                <input required value={leadForm.name} onChange={e => setLeadForm({...leadForm, name: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Enter name" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Mobile Number *</label>
                <input
                  required
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]{10}"
                  maxLength={10}
                  value={leadForm.phone}
                  onChange={e => setLeadForm({...leadForm, phone: normalizePhone(e.target.value).slice(0, 10)})}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="10-digit mobile"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Source *</label>
                <input required value={leadForm.source} onChange={e => setLeadForm({...leadForm, source: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g. Website, Instagram, Outdoor" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Allocation Mode</label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setLeadAllocationMode('auto')}
                    className={cn(
                      "py-2 text-sm font-bold rounded-lg transition-colors",
                      leadAllocationMode === 'auto' ? "bg-white text-blue-600 shadow-sm" : "text-gray-600 hover:text-gray-800"
                    )}
                  >
                    Automatic
                  </button>
                  <button
                    type="button"
                    onClick={() => setLeadAllocationMode('manual')}
                    className={cn(
                      "py-2 text-sm font-bold rounded-lg transition-colors",
                      leadAllocationMode === 'manual' ? "bg-white text-blue-600 shadow-sm" : "text-gray-600 hover:text-gray-800"
                    )}
                  >
                    Manual
                  </button>
                </div>
              </div>
              {leadAllocationMode === 'manual' && (
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Assign To (Active Employee)</label>
                  <select
                    required
                    value={manualLeadAssigneeId}
                    onChange={e => setManualLeadAssigneeId(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="">Select employee</option>
                    {employees
                      .filter(emp => emp.role === 'employee')
                      .map(emp => (
                        <option key={emp.uid} value={emp.uid}>{emp.name} ({emp.phone})</option>
                      ))}
                  </select>
                </div>
              )}
              <div className="flex gap-3 pt-6 mt-2 border-t border-gray-100">
                <button type="button" onClick={() => setShowAddLead(false)} className="flex-1 py-3.5 font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition-colors">Cancel</button>
                <button type="submit" disabled={loading} className="flex-1 py-3.5 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-200 active:scale-95 transition-all">
                  {loading ? 'Adding...' : 'Allocate Lead'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {showAddEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <h3 className="text-2xl font-bold mb-6 text-gray-900">Add Employee</h3>
            <form onSubmit={handleAddEmployee} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Full Name</label>
                <input required value={employeeForm.name} onChange={e => setEmployeeForm({...employeeForm, name: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Mobile Number</label>
                <input
                  required
                  type="tel"
                  inputMode="numeric"
                  minLength={10}
                  maxLength={15}
                  value={employeeForm.phone}
                  onChange={e => setEmployeeForm({...employeeForm, phone: e.target.value})}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <p className="text-xs text-gray-500">Employee account will be created immediately. Initial password will be the mobile number.</p>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowAddEmployee(false)} className="flex-1 py-3 font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition-colors">Cancel</button>
                <button type="submit" disabled={loading} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-200 active:scale-95 transition-all">
                  {loading ? 'Adding...' : 'Add Employee'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
      <AnimatePresence>
        {saveToast && (
          <motion.div
            initial={{ opacity: 0, y: -14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className="fixed top-20 right-4 z-[140] w-[300px] max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-200 bg-white/95 px-4 py-3 shadow-2xl backdrop-blur"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                <CheckCircle2 size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{saveToast.title}</p>
                <p className="text-xs text-gray-500">{saveToast.description}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
