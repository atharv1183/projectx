import React, { useState, useEffect, FormEvent } from 'react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp, 
  orderBy,
  Timestamp 
} from 'firebase/firestore';
import { GoogleMap, useJsApiLoader, MarkerF } from '@react-google-maps/api';
import { db, auth } from '../lib/firebase';
import { 
  InventoryItem, 
  InventoryType, 
  HouseType, 
  InventoryStatus, 
  User, 
  OperationType 
} from '../types';
import { handleFirestoreError, cn, convertArea, AREA_CONVERSIONS } from '../lib/utils';
import { 
  Plus, 
  Search, 
  Image as ImageIcon, 
  File, 
  Check, 
  X, 
  Trash2, 
  Edit2, 
  MapPin, 
  Maximize2, 
  Home, 
  Landmark,
  Upload,
  ChevronDown,
  Info,
  Clock,
  LayoutGrid,
  FileCheck,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';

interface InventoryManagementProps {
  user: User;
  onBack?: () => void;
}

interface MapPickerProps {
  apiKey: string;
  latitude: number;
  longitude: number;
  onPick: (lat: number, lng: number) => void;
}

function MapPicker({ apiKey, latitude, longitude, onPick }: MapPickerProps) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: apiKey,
  });

  const mapContainerStyle = {
    width: '100%',
    height: '300px',
    borderRadius: '24px'
  };

  if (loadError) {
    return (
      <div className="w-full h-[300px] bg-slate-100 rounded-[32px] flex items-center justify-center text-slate-500 font-bold text-sm text-center px-6">
        Could not load Google Map. Please verify your Maps API key.
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="w-full h-[300px] bg-slate-100 rounded-[32px] flex items-center justify-center text-slate-400 font-bold text-sm">
        Loading Map...
      </div>
    );
  }

  return (
    <div className="border-4 border-slate-50 rounded-[32px] overflow-hidden shadow-inner">
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={{ lat: latitude, lng: longitude }}
        zoom={15}
        onClick={(e) => {
          if (e.latLng) {
            onPick(e.latLng.lat(), e.latLng.lng());
          }
        }}
        options={{
          disableDefaultUI: true,
          zoomControl: true,
          styles: [
            {
              featureType: "all",
              elementType: "labels.text.fill",
              stylers: [{ color: "#616161" }]
            },
            {
              featureType: "landscape",
              elementType: "all",
              stylers: [{ color: "#f5f5f5" }]
            },
            {
              featureType: "water",
              elementType: "all",
              stylers: [{ color: "#e9e9e9" }]
            },
            {
              featureType: "road",
              elementType: "all",
              stylers: [{ saturation: -100 }]
            }
          ]
        }}
      >
        <MarkerF position={{ lat: latitude, lng: longitude }} />
      </GoogleMap>
    </div>
  );
}

function toMillis(value: unknown): number {
  if (!value) return 0;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 0 : value.getTime();
  }

  if (typeof value === 'object' && value !== null) {
    const maybeTimestamp = value as { toDate?: () => Date; seconds?: number };

    if (typeof maybeTimestamp.toDate === 'function') {
      const parsed = maybeTimestamp.toDate();
      return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : 0;
    }

    if (typeof maybeTimestamp.seconds === 'number') {
      return maybeTimestamp.seconds * 1000;
    }
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: number | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}

export default function InventoryManagement({ user, onBack }: InventoryManagementProps) {
  const isAdmin = user.role === 'admin';
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'draft'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Form State
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    type: 'zameen' as InventoryType,
    areaValue: '' as string | number,
    areaUnit: 'sqft' as keyof typeof AREA_CONVERSIONS,
    rate: '' as string | number,
    rateUnit: 'total',
    location: '',
    nearbyLocation: '',
    landmark: '',
    houseType: 'simplex' as HouseType,
    bhk: '' as string | number,
    bathrooms: '' as string | number,
    kitchenType: '',
    features: [] as string[],
    newFeature: '',
    latitude: 20.5937 as number, // Default India center
    longitude: 78.9629 as number
  });

  const mapsApiKey = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
  const hasMapsApiKey = mapsApiKey.length > 0;
  const cloudinaryCloudName = String(import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || '').trim();
  const cloudinaryUploadPreset = String(import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || '').trim();
  const hasCloudinaryConfig = cloudinaryCloudName.length > 0 && cloudinaryUploadPreset.length > 0;

  const [files, setFiles] = useState<{ photos: File[], attachments: File[] }>({
    photos: [],
    attachments: []
  });

  useEffect(() => {
    let unsubscribeApproved: () => void;
    let unsubscribePersonal: () => void;
    
    if (isAdmin) {
      const q = query(collection(db, 'inventory'), orderBy('createdAt', 'desc'));
      unsubscribeApproved = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
        setItems(data);
      }, (error) => handleFirestoreError(error, OperationType.LIST, 'inventory'));
      return () => unsubscribeApproved();
    } else {
      // For employees, we need two separate listeners to satisfy security rules 
      // which block broad listing of all items (including others' drafts).
      
      const qApproved = query(
        collection(db, 'inventory'), 
        where('status', '==', 'approved')
      );
      
      const qPersonal = query(
        collection(db, 'inventory'),
        where('submitterId', '==', user.uid)
      );

      const approvedItems: InventoryItem[] = [];
      const personalItems: InventoryItem[] = [];

      const updateItems = () => {
        const merged = [...approvedItems, ...personalItems];
        // Deduplicate and sort
        const unique = merged.filter((item, index, self) => 
          index === self.findIndex((t) => t.id === item.id)
        ).sort((a, b) => {
           return toMillis(b.createdAt) - toMillis(a.createdAt);
        });
        setItems(unique);
      };

      unsubscribeApproved = onSnapshot(qApproved, (snapshot) => {
        approvedItems.length = 0;
        snapshot.docs.forEach(doc => approvedItems.push({ id: doc.id, ...doc.data() } as InventoryItem));
        updateItems();
      }, (error) => handleFirestoreError(error, OperationType.LIST, 'inventory'));

      unsubscribePersonal = onSnapshot(qPersonal, (snapshot) => {
        personalItems.length = 0;
        snapshot.docs.forEach(doc => personalItems.push({ id: doc.id, ...doc.data() } as InventoryItem));
        updateItems();
      }, (error) => handleFirestoreError(error, OperationType.LIST, 'inventory'));

      return () => {
        unsubscribeApproved();
        unsubscribePersonal();
      };
    }
  }, [isAdmin, user.uid]);

  const handleAreaChange = (val: string) => {
    setFormData(prev => ({ ...prev, areaValue: val }));
  };

  const handleFileUpload = async (file: File, path: string, timeoutMs: number = 12000) => {
    if (!hasCloudinaryConfig) {
      throw new Error('Cloudinary is not configured. Add VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET.');
    }

    const endpoint = `https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/auto/upload`;
    const body = new FormData();
    body.append('file', file);
    body.append('upload_preset', cloudinaryUploadPreset);
    body.append('folder', `inventory/${path}`);

    const response = await withTimeout(
      fetch(endpoint, {
        method: 'POST',
        body,
      }),
      timeoutMs,
      `Upload timed out for ${file.name}.`
    );

    const result = await withTimeout(
      response.json() as Promise<{ secure_url?: string; error?: { message?: string } }>,
      Math.min(timeoutMs, 8000),
      `Could not parse upload response for ${file.name}.`
    );

    if (!response.ok || !result.secure_url) {
      const reason = result?.error?.message || 'Unknown upload error';
      throw new Error(`Cloudinary upload failed for ${file.name}: ${reason}`);
    }

    return result.secure_url;
  };

  const handleSubmit = async (e: FormEvent, isDraftSubmission: boolean = false) => {
    if (e) e.preventDefault();
    if (!formData.title || !formData.areaValue || !formData.rate || !formData.location) {
      alert('Please fill all mandatory fields');
      return;
    }

    if (!editingItem && files.photos.length === 0) {
      alert('At least one property photo is required');
      return;
    }

    if ((files.photos.length > 0 || files.attachments.length > 0) && !hasCloudinaryConfig) {
      alert('Cloudinary is not configured. Please set VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET in .env.local.');
      return;
    }

    setLoading(true);
    try {
      // 1. Convert Area
      const converted = convertArea(Number(formData.areaValue), formData.areaUnit);
      
      // 2. Upload files (best effort). If uploads fail due CORS/network,
      // keep saving the listing metadata instead of blocking the whole flow.
      const uploadWarnings: string[] = [];
      const photoUrls = editingItem ? [...editingItem.photos] : [];
      for (const file of files.photos) {
        try {
          const url = await handleFileUpload(file, 'photos');
          photoUrls.push(url);
        } catch (uploadError) {
          console.error('Photo upload failed:', uploadError);
          uploadWarnings.push(`Photo upload failed: ${file.name}`);
        }
      }

      if (!editingItem && photoUrls.length === 0) {
        alert('Could not upload required property photo. Please retry.');
        return;
      }

      const attachmentData = editingItem ? [...editingItem.attachments] : [];
      for (const file of files.attachments) {
        try {
          const url = await handleFileUpload(file, 'attachments');
          attachmentData.push({ name: file.name, url });
        } catch (uploadError) {
          console.error('Attachment upload failed:', uploadError);
          uploadWarnings.push(`Document upload failed: ${file.name}`);
        }
      }

      const payload: Partial<InventoryItem> = {
        title: formData.title,
        type: formData.type,
        areaAcre: converted.acre,
        areaSqft: converted.sqft,
        areaSqYard: converted.sqyard,
        areaSqMtr: converted.sqmtr,
        areaHectare: converted.hectare,
        rate: Number(formData.rate),
        rateUnit: formData.rateUnit,
        location: formData.location,
        nearbyLocation: formData.nearbyLocation,
        landmark: formData.landmark,
        latitude: formData.latitude,
        longitude: formData.longitude,
        photos: photoUrls,
        attachments: attachmentData,
        updatedAt: serverTimestamp(),
      };

      if (formData.type === 'house') {
        payload.houseType = formData.houseType;
        payload.bhk = Number(formData.bhk);
        payload.bathrooms = Number(formData.bathrooms);
        payload.kitchenType = formData.kitchenType;
        payload.features = formData.features;
      }

      if (editingItem) {
        const updatePayload = {
          ...payload,
          status: isDraftSubmission ? 'draft' : (isAdmin ? 'approved' : 'pending_approval')
        };
        await updateDoc(doc(db, 'inventory', editingItem.id), updatePayload);
      } else {
        await addDoc(collection(db, 'inventory'), {
          ...payload,
          status: isDraftSubmission ? 'draft' : (isAdmin ? 'approved' : 'pending_approval'),
          submitterId: user.uid,
          submitterName: user.name,
          createdAt: serverTimestamp(),
        });
      }

      setShowForm(false);
      setEditingItem(null);
      setFormData({
        title: '',
        type: 'zameen',
        areaValue: '',
        areaUnit: 'sqft',
        rate: '',
        rateUnit: 'total',
        location: '',
        nearbyLocation: '',
        landmark: '',
        houseType: 'simplex',
        bhk: '',
        bathrooms: '',
        kitchenType: '',
        features: [],
        newFeature: ''
      });
      setFiles({ photos: [], attachments: [] });
      
      const successMessage = isDraftSubmission 
        ? 'Listing saved as draft!' 
        : (editingItem ? 'Listing updated!' : 'Listing submitted for approval!');
      if (uploadWarnings.length > 0) {
        alert(`${successMessage}\n\nSome files could not be uploaded.\n${uploadWarnings.join('\n')}`);
      } else {
        alert(successMessage);
      }
    } catch (error) {
      const message = handleFirestoreError(error, editingItem ? OperationType.UPDATE : OperationType.CREATE, 'inventory');
      alert(message);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: string, status: InventoryStatus) => {
    try {
      await updateDoc(doc(db, 'inventory', id), {
        status,
        approvedBy: user.name,
        approvalAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `inventory/${id}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this listing?')) return;
    try {
      await deleteDoc(doc(db, 'inventory', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `inventory/${id}`);
    }
  };

  const startEdit = (item: InventoryItem) => {
    setEditingItem(item);
    setFormData({
      title: item.title,
      type: item.type,
      // We'll default to sqft for editing view or store the original unit used
      areaValue: item.areaSqft || 0,
      areaUnit: 'sqft',
      rate: item.rate,
      rateUnit: item.rateUnit,
      location: item.location,
      nearbyLocation: item.nearbyLocation || '',
      landmark: item.landmark || '',
      houseType: item.houseType || 'simplex',
      bhk: item.bhk || '',
      bathrooms: item.bathrooms || '',
      kitchenType: item.kitchenType || '',
      features: item.features || [],
      newFeature: '',
      latitude: (item as any).latitude || 20.5937,
      longitude: (item as any).longitude || 78.9629
    });
    setShowForm(true);
  };

  const filteredItems = items.filter(item => {
    const matchesFilter = filter === 'all' 
      ? item.status !== 'draft' || item.submitterId === user.uid
      : item.status === (
          filter === 'pending' ? 'pending_approval' : 
          filter === 'approved' ? 'approved' : 
          'draft'
        );
    const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          item.location.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const areaUnits = Object.keys(AREA_CONVERSIONS) as Array<keyof typeof AREA_CONVERSIONS>;
  const areaUnitLabels: Record<keyof typeof AREA_CONVERSIONS, string> = {
    acre: 'Acre',
    sqft: 'Sqft',
    sqyard: 'Sqyard',
    sqmtr: 'Sqmtr',
    hectare: 'Hectare',
  };

  return (
    <div className="space-y-8 pb-24 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 px-1">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
             <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-200">
                <LayoutGrid size={24} />
             </div>
             <div>
                <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                  Inventory
                </h2>
                <p className="text-slate-400 font-bold text-xs uppercase tracking-widest">
                  {isAdmin ? 'Property Portfolio' : 'My Listings'}
                </p>
             </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {onBack && (
             <button 
                onClick={onBack}
                className="px-5 py-3 bg-white border border-slate-200 text-slate-600 font-bold text-xs uppercase tracking-widest rounded-2xl hover:bg-slate-50 transition-all active:scale-95"
              >
                Back
              </button>
          )}
          <button 
            onClick={() => {
              setEditingItem(null);
              setShowForm(true);
            }}
            className="px-6 py-3 bg-slate-900 text-white font-bold text-xs uppercase tracking-widest rounded-2xl shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all flex items-center gap-2 active:scale-95"
          >
            <Plus size={18} /> New Listing
          </button>
        </div>
      </div>

      {/* Filters & Search - Refined */}
      <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center bg-white/50 p-2 rounded-[32px] border border-slate-100">
        <div className="flex-1 relative group">
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={20} />
          <input 
            type="text"
            placeholder="Search listings..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-14 pr-6 py-4 bg-white rounded-3xl outline-none border border-transparent focus:border-blue-100 focus:bg-white font-semibold text-slate-700 transition-all shadow-sm"
          />
        </div>
        <div className="flex bg-slate-200/50 p-1 rounded-2xl gap-1 overflow-x-auto no-scrollbar whitespace-nowrap">
          {[
            { id: 'all', label: 'All', icon: LayoutGrid },
            { id: 'approved', label: 'Live', icon: FileCheck },
            { id: 'pending', label: 'Awaiting', icon: Clock },
            { id: 'draft', label: 'Drafts', icon: Edit2 }
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setFilter(t.id as any)}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                filter === t.id ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid - Improved spacing and density */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6 px-1">
        <AnimatePresence mode="popLayout">
          {filteredItems.map(item => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="group bg-white rounded-[32px] border border-slate-100 overflow-hidden hover:shadow-2xl hover:shadow-slate-200/50 transition-all duration-500 flex flex-col h-full"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-slate-50">
                {item.photos?.[0] ? (
                  <img src={item.photos[0]} alt={item.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-300">
                    <ImageIcon size={48} strokeWidth={1} />
                  </div>
                )}
                
                {/* Status Badges */}
                <div className="absolute top-4 left-4 flex flex-col gap-2">
                   <div className={cn(
                    "px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.2em] backdrop-blur-md shadow-lg",
                    item.status === 'approved' ? "bg-emerald-500/90 text-white" : 
                    item.status === 'pending_approval' ? "bg-amber-500/90 text-white" : 
                    item.status === 'draft' ? "bg-slate-500/90 text-white" :
                    "bg-rose-500/90 text-white"
                  )}>
                    {item.status.replace('_', ' ')}
                  </div>
                  <div className="px-4 py-1.5 bg-black/60 backdrop-blur-md text-white rounded-full text-[9px] font-black uppercase tracking-[0.2em]">
                    {item.type}
                  </div>
                </div>

                {/* Admin Quick Actions */}
                {isAdmin && item.status === 'pending_approval' && (
                  <>
                    <div className="absolute top-3 right-3 z-20 flex items-center gap-2 sm:hidden">
                      <button
                        onClick={() => handleApprove(item.id, 'approved')}
                        className="w-12 h-12 rounded-full bg-white text-emerald-600 flex items-center justify-center shadow-xl border border-emerald-100 active:scale-95 transition-all"
                        aria-label="Approve listing"
                        title="Approve listing"
                      >
                        <Check size={24} strokeWidth={3} />
                      </button>
                      <button
                        onClick={() => handleApprove(item.id, 'rejected')}
                        className="w-12 h-12 rounded-full bg-white text-rose-600 flex items-center justify-center shadow-xl border border-rose-100 active:scale-95 transition-all"
                        aria-label="Reject listing"
                        title="Reject listing"
                      >
                        <X size={24} strokeWidth={3} />
                      </button>
                    </div>

                    <div className="hidden sm:flex absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity items-center justify-center gap-4">
                      <button 
                        onClick={() => handleApprove(item.id, 'approved')}
                        className="w-14 h-14 rounded-full bg-white text-emerald-600 flex items-center justify-center hover:scale-110 transition-all shadow-2xl"
                        aria-label="Approve listing"
                        title="Approve listing"
                      >
                        <Check size={28} strokeWidth={3} />
                      </button>
                      <button 
                        onClick={() => handleApprove(item.id, 'rejected')}
                        className="w-14 h-14 rounded-full bg-white text-rose-600 flex items-center justify-center hover:scale-110 transition-all shadow-2xl"
                        aria-label="Reject listing"
                        title="Reject listing"
                      >
                        <X size={28} strokeWidth={3} />
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="p-6 space-y-6 flex-1 flex flex-col">
                <div className="space-y-2">
                  <h3 className="text-xl font-extrabold text-slate-900 tracking-tight leading-tight group-hover:text-blue-600 transition-colors line-clamp-2">
                    {item.title}
                  </h3>
                  <div className="flex items-center gap-2 text-slate-400 text-sm font-medium">
                    <MapPin size={14} className="text-blue-500" />
                    {item.location}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 rounded-2xl">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 leading-none">Area</p>
                    <p className="text-slate-900 font-mono font-bold text-lg leading-none">
                      {item.areaValue} <span className="text-[10px] text-slate-400 font-sans tracking-normal ml-0.5">{item.areaUnit}</span>
                    </p>
                  </div>
                  <div className="p-4 bg-blue-50 rounded-2xl">
                    <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-1.5 leading-none">Rate</p>
                    <p className="text-blue-600 font-mono font-bold text-lg leading-none">
                      <span className="text-sm mr-0.5">₹</span>{Number(item.rate).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 mt-auto border-t border-slate-50">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-xs shadow-inner">
                      {item.submitterName.charAt(0)}
                    </div>
                    <div className="max-w-[100px]">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.1em] leading-none mb-1">Listed by</p>
                      <p className="text-xs font-bold text-slate-700 leading-none truncate">{item.submitterName}</p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button 
                      onClick={() => startEdit(item)}
                      className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                    >
                      <Edit2 size={18} />
                    </button>
                    {(isAdmin || (item.submitterId === user.uid && item.status === 'draft')) && (
                      <button 
                        onClick={() => handleDelete(item.id)}
                        className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {filteredItems.length === 0 && (
          <div className="col-span-full py-40 bg-white/50 rounded-[64px] border-4 border-dashed border-slate-100 flex flex-col items-center justify-center text-center">
            <div className="w-24 h-24 bg-slate-50 text-slate-200 rounded-full flex items-center justify-center mb-6">
              <Search size={48} />
            </div>
            <h3 className="text-xl font-black text-slate-800 tracking-tight">No property found</h3>
            <p className="text-slate-400 font-bold mt-2">Try adjusting your filters or search terms</p>
          </div>
        )}
      </div>

      {/* Form Modal */}
      <AnimatePresence>
        {showForm && (
          <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-xl flex items-center justify-center p-0 sm:p-4 lg:p-10">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full h-full sm:h-auto sm:max-h-[90vh] max-w-5xl bg-white sm:rounded-[48px] overflow-hidden shadow-2xl flex flex-col"
            >
              <form onSubmit={handleSubmit} className="flex flex-col h-full overflow-hidden">
                <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-xl shadow-blue-200">
                      <Plus size={22} className="sm:hidden" />
                      <Plus size={26} className="hidden sm:block" />
                    </div>
                    <div>
                      <h3 className="text-lg sm:text-2xl font-black text-slate-900 tracking-tight">
                        {editingItem ? 'Edit Property' : 'Add New Property'}
                      </h3>
                      <p className="text-slate-400 font-bold text-[9px] sm:text-[10px] uppercase tracking-[0.2em] mt-0.5">Property details & media</p>
                    </div>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => {
                        setShowForm(false);
                        setEditingItem(null);
                    }} 
                    className="w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-white text-slate-400 hover:text-rose-500 transition-all flex items-center justify-center shadow-lg shadow-slate-200/50"
                  >
                    <X size={18} className="sm:hidden" />
                    <X size={22} className="hidden sm:block" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto min-h-0 bg-white">
                  <div className="max-w-5xl mx-auto p-6 sm:p-10 lg:p-12">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 sm:gap-12">
                      {/* Left Column: Core Info */}
                      <div className="space-y-10">
                        <section className="space-y-6">
                          <header className="flex items-center gap-3 border-b border-slate-100 pb-4">
                            <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center">
                              <FileText size={20} />
                            </div>
                            <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">Basic info</h3>
                          </header>

                          <div className="space-y-4">
                            <div className="space-y-2">
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Listing Title</label>
                              <input 
                                required
                                value={formData.title}
                                onChange={e => setFormData({...formData, title: e.target.value})}
                                className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-4 focus:ring-blue-100 focus:bg-white outline-none font-bold text-slate-700 transition-all"
                                placeholder="Prime Property Title"
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Property Type</label>
                                <select 
                                  value={formData.type}
                                  onChange={e => setFormData({...formData, type: e.target.value as InventoryType})}
                                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-4 focus:ring-blue-100 outline-none font-black text-slate-700 transition-all"
                                >
                                  <option value="zameen">Zameen</option>
                                  <option value="plot">Plot</option>
                                  <option value="house">House/Villa</option>
                                </select>
                              </div>
                              <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Rate (₹)</label>
                                <input 
                                  required
                                  type="number"
                                  value={formData.rate}
                                  onChange={e => setFormData({...formData, rate: e.target.value})}
                                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-4 focus:ring-blue-100 outline-none font-mono font-bold text-slate-700 transition-all"
                                  placeholder="0.00"
                                />
                              </div>
                            </div>
                          </div>
                        </section>

                        <section className="space-y-6">
                           <header className="flex items-center gap-3 border-b border-slate-100 pb-4">
                            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-100">
                              <MapPin size={20} />
                            </div>
                            <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">Location</h3>
                          </header>

                          <div className="space-y-4">
                            <div className="space-y-2">
                               <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Primary Location</label>
                               <input 
                                  required
                                  value={formData.location}
                                  onChange={e => setFormData({...formData, location: e.target.value})}
                                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-4 focus:ring-blue-100 outline-none font-bold text-slate-700 transition-all"
                                  placeholder="City / Area"
                               />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <input 
                                value={formData.nearbyLocation}
                                onChange={e => setFormData({...formData, nearbyLocation: e.target.value})}
                                className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-4 focus:ring-blue-100 outline-none font-bold text-slate-700 transition-all"
                                placeholder="Sub-locality"
                              />
                              <input 
                                value={formData.landmark}
                                onChange={e => setFormData({...formData, landmark: e.target.value})}
                                className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-4 focus:ring-blue-100 outline-none font-bold text-slate-700 transition-all"
                                placeholder="Landmark"
                              />
                            </div>

                            <div className="space-y-3 pt-2">
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 flex items-center gap-2">
                                <Maximize2 size={12} className="text-blue-500" /> Pin Exact Location (Mandatory)
                              </label>
                              {hasMapsApiKey ? (
                                <MapPicker
                                  apiKey={mapsApiKey}
                                  latitude={formData.latitude}
                                  longitude={formData.longitude}
                                  onPick={(lat, lng) => {
                                    setFormData({
                                      ...formData,
                                      latitude: lat,
                                      longitude: lng
                                    });
                                  }}
                                />
                              ) : (
                                <div className="w-full h-[300px] bg-slate-100 rounded-[32px] flex items-center justify-center text-slate-500 font-bold text-sm text-center px-6">
                                  Google Map is disabled. Add `VITE_GOOGLE_MAPS_API_KEY` in `.env.local` to enable map pinning.
                                </div>
                              )}
                              <div className="grid grid-cols-2 gap-4">
                                <input
                                  type="number"
                                  step="any"
                                  value={formData.latitude}
                                  onChange={(e) => setFormData({ ...formData, latitude: Number(e.target.value) || 0 })}
                                  className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-4 focus:ring-blue-100 outline-none font-mono font-bold text-slate-700 transition-all"
                                  placeholder="Latitude"
                                />
                                <input
                                  type="number"
                                  step="any"
                                  value={formData.longitude}
                                  onChange={(e) => setFormData({ ...formData, longitude: Number(e.target.value) || 0 })}
                                  className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-4 focus:ring-blue-100 outline-none font-mono font-bold text-slate-700 transition-all"
                                  placeholder="Longitude"
                                />
                              </div>
                              <p className="text-[10px] text-slate-400 text-center font-bold">
                                Latitude: {formData.latitude.toFixed(6)} | Longitude: {formData.longitude.toFixed(6)}
                              </p>
                            </div>
                          </div>
                          
                          {formData.type === 'house' && (
                            <motion.div 
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              className="bg-blue-50/50 p-6 sm:p-8 rounded-[32px] border border-blue-100 space-y-6 mt-6"
                            >
                              <header className="flex items-center gap-3 border-b border-blue-100/50 pb-4">
                                <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center">
                                  <Home size={16} />
                                </div>
                                <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest">House Details</h4>
                              </header>
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <label className="text-[10px] font-black text-blue-400 uppercase tracking-widest ml-1">BHK</label>
                                  <input 
                                    type="number"
                                    value={formData.bhk}
                                    onChange={e => setFormData({...formData, bhk: e.target.value})}
                                    className="w-full px-4 py-3 bg-white border border-blue-100 rounded-xl focus:ring-4 focus:ring-blue-200 outline-none font-bold text-blue-900"
                                    placeholder="e.g. 3"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <label className="text-[10px] font-black text-blue-400 uppercase tracking-widest ml-1">Bathrooms</label>
                                  <input 
                                    type="number"
                                    value={formData.bathrooms}
                                    onChange={e => setFormData({...formData, bathrooms: e.target.value})}
                                    className="w-full px-4 py-3 bg-white border border-blue-100 rounded-xl focus:ring-4 focus:ring-blue-200 outline-none font-bold text-blue-900"
                                    placeholder="e.g. 2"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <label className="text-[10px] font-black text-blue-400 uppercase tracking-widest ml-1">House Type</label>
                                  <select 
                                    value={formData.houseType}
                                    onChange={e => setFormData({...formData, houseType: e.target.value as HouseType})}
                                    className="w-full px-4 py-3 bg-white border border-blue-100 rounded-xl focus:ring-4 focus:ring-blue-200 outline-none font-black text-blue-900"
                                  >
                                    <option value="simplex">Simplex</option>
                                    <option value="semi-duplex">Semi-Duplex</option>
                                    <option value="duplex">Duplex</option>
                                  </select>
                                </div>
                                <div className="space-y-2">
                                  <label className="text-[10px] font-black text-blue-400 uppercase tracking-widest ml-1">Kitchen</label>
                                  <input 
                                    value={formData.kitchenType}
                                    onChange={e => setFormData({...formData, kitchenType: e.target.value})}
                                    className="w-full px-4 py-3 bg-white border border-blue-100 rounded-xl focus:ring-4 focus:ring-blue-200 outline-none font-bold text-blue-900"
                                    placeholder="e.g. Modular"
                                  />
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </section>
                      </div>

                      {/* Right Column: Measurements & Media */}
                      <div className="space-y-10">
                        <section className="bg-slate-50 rounded-[32px] p-8 border border-slate-100 space-y-6">
                           <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest">Measurements</h4>
                            <div
                              className="grid w-full grid-cols-3 sm:grid-cols-5 gap-1.5 p-1.5 bg-white border border-slate-200 rounded-xl"
                            >
                                {areaUnits.map(u => (
                                    <button
                                        key={u}
                                        type="button"
                                        onClick={() => setFormData({...formData, areaUnit: u})}
                                        className={cn(
                                            "min-w-0 h-8 px-2 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all text-center",
                                            formData.areaUnit === u ? "bg-slate-900 text-white shadow-lg" : "text-slate-400 hover:text-slate-600"
                                        )}
                                    >
                                        {areaUnitLabels[u]}
                                    </button>
                                ))}
                            </div>
                           </div>

                           <div className="space-y-2">
                             <input 
                                required
                                type="number"
                                step="any"
                                value={formData.areaValue}
                                onChange={e => handleAreaChange(e.target.value)}
                                className="w-full px-8 py-6 bg-white border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-100 outline-none font-mono font-bold tabular-nums text-2xl text-slate-900 transition-all text-center"
                                placeholder="0.00"
                             />
                           </div>

                           <div className="grid grid-cols-2 gap-4">
                              {areaUnits.map(u => {
                                  if (u === formData.areaUnit) return null;
                                  const val = formData.areaValue ? convertArea(Number(formData.areaValue), formData.areaUnit)[u as keyof typeof AREA_CONVERSIONS] : '-';
                                  return (
                                      <div key={u} className="bg-white min-h-[56px] px-4 py-3 rounded-xl border border-slate-200 flex items-center justify-between gap-3">
                                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wide">{areaUnitLabels[u]}</p>
                                          <p className="text-sm font-mono font-bold tabular-nums text-slate-800 text-right">{val}</p>
                                      </div>
                                  )
                              })}
                           </div>
                        </section>

                        <section className="space-y-6">
                           <header className="flex items-center justify-between border-b border-slate-100 pb-4">
                             <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-orange-500 text-white flex items-center justify-center">
                                  <ImageIcon size={20} />
                                </div>
                                <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">Photos</h3>
                             </div>
                             <p className="text-[10px] font-bold text-slate-400 uppercase">Min 1 Required</p>
                           </header>

                           <div className="grid grid-cols-3 gap-4">
                              {[...files.photos, ...(editingItem?.photos || [])].map((f, i) => (
                                 <div key={i} className="relative aspect-square rounded-2xl overflow-hidden bg-slate-100 group">
                                    <img 
                                      src={typeof f === 'string' ? f : URL.createObjectURL(f)} 
                                      className="w-full h-full object-cover" 
                                    />
                                    <button 
                                       type="button"
                                       onClick={() => {
                                          if (typeof f === 'string') {
                                            if (editingItem) {
                                              setEditingItem({...editingItem, photos: editingItem.photos.filter((_, idx) => editingItem.photos[idx] !== f)});
                                            }
                                          } else {
                                            setFiles({...files, photos: files.photos.filter((_, idx) => files.photos[idx] !== f)});
                                          }
                                       }}
                                       className="absolute inset-0 bg-rose-600/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                                    >
                                       <Trash2 size={24} />
                                    </button>
                                 </div>
                              ))}
                              <label className="aspect-square rounded-2xl border-2 border-dashed border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-all cursor-pointer flex flex-col items-center justify-center text-slate-400 hover:text-blue-600 group">
                                 <Upload size={24} className="group-hover:-translate-y-1 transition-transform" />
                                 <span className="text-[9px] font-black uppercase mt-1">Add</span>
                                 <input type="file" accept="image/*" multiple className="hidden" onChange={e => {
                                     if(e.target.files) setFiles({...files, photos: [...files.photos, ...Array.from(e.target.files)]});
                                 }} />
                              </label>
                           </div>
                        </section>

                        <section className="space-y-6">
                           <header className="flex items-center justify-between border-b border-slate-100 pb-4">
                             <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-indigo-500 text-white flex items-center justify-center">
                                  <File size={20} />
                                </div>
                                <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">Documents</h3>
                             </div>
                             <p className="text-[10px] font-bold text-slate-400 uppercase">Optional</p>
                           </header>

                           <div className="space-y-3">
                              {[...files.attachments, ...(editingItem?.attachments || [])].map((f, i) => (
                                 <div key={i} className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-2xl group">
                                    <div className="flex items-center gap-3">
                                       <FileText size={20} className="text-indigo-500" />
                                       <p className="text-sm font-bold text-slate-700 truncate max-w-[200px]">
                                          {typeof f === 'object' && 'name' in f ? (f as { name: string }).name : (f as any).name}
                                       </p>
                                    </div>
                                    <button 
                                       type="button"
                                       onClick={() => {
                                          if (typeof f === 'object' && 'url' in f) {
                                            if (editingItem) {
                                              setEditingItem({...editingItem, attachments: editingItem.attachments.filter((_, idx) => editingItem.attachments[idx] !== f)});
                                            }
                                          } else {
                                            setFiles({...files, attachments: files.attachments.filter((_, idx) => files.attachments[idx] !== f)});
                                          }
                                       }}
                                       className="text-slate-400 hover:text-rose-500 transition-colors"
                                    >
                                       <Trash2 size={18} />
                                    </button>
                                 </div>
                              ))}
                              <label className="w-full flex items-center justify-center gap-3 p-6 border-2 border-dashed border-slate-200 rounded-2xl cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-all text-slate-400 hover:text-indigo-600 group">
                                  <Upload size={24} className="group-hover:-translate-y-1 transition-transform" />
                                  <span className="text-xs font-black uppercase tracking-widest">Add Documents</span>
                                  <input 
                                     type="file"
                                     multiple
                                     className="hidden"
                                     onChange={e => {
                                         if(e.target.files) setFiles({...files, attachments: [...files.attachments, ...Array.from(e.target.files)]});
                                     }}
                                  />
                              </label>
                           </div>
                        </section>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-3 sm:p-4 md:p-5 bg-white border-t border-slate-100 flex flex-col sm:flex-row gap-3 shrink-0">
                  <div className="flex flex-1 gap-3">
                    <button 
                      type="button" 
                      onClick={() => { setShowForm(false); setEditingItem(null); }}
                      className="flex-1 sm:flex-none px-7 py-3 bg-white border border-slate-200 text-slate-500 font-bold text-xs uppercase tracking-widest rounded-2xl hover:bg-slate-50 transition-all"
                    >
                      Cancel
                    </button>
                    <button 
                      type="button" 
                      disabled={loading}
                      onClick={(e) => handleSubmit(e as any, true)}
                      className="flex-1 sm:flex-none px-7 py-3 bg-white border border-slate-200 text-slate-900 font-bold text-xs uppercase tracking-widest rounded-2xl hover:bg-slate-50 transition-all disabled:opacity-50"
                    >
                      Draft
                    </button>
                  </div>
                  <button 
                    type="submit"
                    disabled={loading}
                    className="flex-[2] py-3 bg-slate-900 text-white font-black text-xs uppercase tracking-[0.2em] rounded-2xl shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3"
                  >
                    {loading ? (
                        <>
                            <Clock className="animate-spin" size={18} />
                            Saving...
                        </>
                    ) : (
                        editingItem 
                          ? (editingItem.status === 'draft' ? 'Launch Listing' : 'Save Changes') 
                          : (isAdmin ? 'Live Listing' : 'Submit for Review')
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
