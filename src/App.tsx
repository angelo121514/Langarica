import React, { useState, useEffect, useMemo, Component } from 'react';
import { 
  BrowserRouter as Router, 
  Routes, 
  Route, 
  Navigate, 
  Link, 
  useLocation,
  useNavigate
} from 'react-router-dom';
import { 
  onAuthStateChanged, 
  User as FirebaseUser,
  signInWithPopup,
  GoogleAuthProvider,
  signOut
} from 'firebase/auth';
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  getDoc, 
  setDoc, 
  addDoc,
  updateDoc,
  deleteDoc,
  orderBy,
  limit,
  Timestamp,
  where,
  getDocs
} from 'firebase/firestore';
import { 
  LayoutDashboard, 
  Users, 
  MapPin, 
  Shield, 
  LogOut, 
  Clock, 
  AlertTriangle, 
  CheckCircle2, 
  Navigation,
  Menu,
  X,
  Plus,
  ChevronRight,
  Search,
  Filter,
  Map as MapIcon,
  Eye,
  Edit3,
  Trash2,
  Activity,
  Bell,
  Scan,
  Target,
  UserCheck,
  Map as MapIcon2,
  LocateFixed,
  History
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { getDocFromServer } from 'firebase/firestore';

import { auth, db, googleProvider } from './firebase';
import { cn } from './lib/utils';

// --- Error Handling & Testing ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: any[];
  }
}

function handleFirestoreError(error: any, operationType: OperationType, path: string | null) {
  const isNetworkError = error?.code === 'unavailable' || 
                         error?.code === 'failed-precondition' ||
                         error?.message?.includes('offline') ||
                         error?.message?.includes('proxy');

  const isAuthError = error?.code === 'permission-denied' || 
                      error?.code === 'unauthenticated';

  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  
  console.error(`Firestore Error [${operationType}] at ${path}:`, errInfo);
  
  // En modo demo o error de red/auth, solo advertimos para no tumbar la app
  if (isNetworkError || isAuthError || !auth.currentUser || auth.currentUser?.uid?.startsWith('demo-')) {
    console.warn("⚠️ Firestore no disponible o limitado. La app continuará en modo degradado/offline.");
    return;
  }

  // Solo lanzamos error fatal si es algo realmente inesperado y estamos logueados
  // para que el ErrorBoundary lo capture.
  // throw new Error(JSON.stringify(errInfo)); 
  // Nota: Incluso aquí podríamos preferir no lanzar error para una mejor UX.
}

class ErrorBoundary extends (Component as any) {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    const { hasError, errorInfo } = this.state;
    if (hasError) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-slate-900 border border-rose-500/30 p-8 rounded-2xl text-center">
            <AlertTriangle size={48} className="text-rose-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Error del Sistema</h2>
            <p className="text-slate-400 text-sm mb-6">Se ha detectado un problema crítico en la conexión o ejecución.</p>
            <div className="bg-black/50 p-4 rounded-lg mb-6 text-left overflow-auto max-h-40">
              <code className="text-rose-400 text-xs font-mono break-all">{errorInfo}</code>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-white text-slate-950 font-bold py-2 rounded-lg hover:bg-slate-200 transition-colors"
            >
              Reiniciar Aplicación
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

async function testConnection() {
  try {
    // Attempt to fetch a non-existent doc to verify connection
    await getDocFromServer(doc(db, '_connection_test', 'ping'));
    console.log("Firestore connection verified successfully.");
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("CRITICAL: Firestore is offline. Check your configuration.");
    }
    // Other errors (like permission denied on this test path) are expected and mean we ARE connected
  }
}

// --- Types ---
type UserRole = 'guard' | 'supervisor' | 'admin';

interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  active_site_id?: string;
  current_lat?: number;
  current_lng?: number;
  last_location_update?: any;
  is_on_duty?: boolean;
  createdAt: string;
}

interface Site {
  id: string;
  name: string;
  geofence_lat: number;
  geofence_lng: number;
  geofence_radius: number;
  createdAt: string;
}

interface Checkpoint {
  id: string;
  site_id: string;
  name: string;
  lat: number;
  lng: number;
  tolerance_radius: number;
  order?: number;
}

interface AttendanceLog {
  id: string;
  user_id: string;
  site_id: string;
  type: 'in' | 'out';
  timestamp: any;
  lat: number;
  lng: number;
  accuracy: number;
  userName?: string;
  siteName?: string;
}

interface PatrolSession {
  id: string;
  user_id: string;
  site_id: string;
  start_time: any;
  end_time?: any;
  status: 'active' | 'completed' | 'partial' | 'failed';
  visited_checkpoints: string[]; // IDs of checkpoints
  userName?: string;
  siteName?: string;
}

interface Alert {
  id: string;
  user_id: string;
  site_id: string;
  type: 'perimeter_violation' | 'checkpoint_missed' | 'emergency';
  message: string;
  timestamp: any;
  status: 'new' | 'acknowledged' | 'resolved';
  userName?: string;
  siteName?: string;
  lat?: number;
  lng?: number;
}

// --- Utilities ---

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371e3; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
};

// --- Guard Components ---

const GuardDashboard = ({ profile }: { profile: UserProfile }) => {
  const [currentLocation, setCurrentLocation] = useState<{lat: number, lng: number} | null>(null);
  const [assignedSite, setAssignedSite] = useState<Site | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [activePatrol, setActivePatrol] = useState<PatrolSession | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [distanceToSite, setDistanceToSite] = useState<number | null>(null);

  useEffect(() => {
    // Fetch sites
    const unsubSites = onSnapshot(collection(db, 'sites'), (snap) => {
      const siteList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Site));
      setSites(siteList);
      
      if (profile.active_site_id) {
        const site = siteList.find(s => s.id === profile.active_site_id);
        if (site) setAssignedSite(site);
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, 'sites'));

    // Watch location
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setCurrentLocation({ lat: latitude, lng: longitude });
        
        // Update profile in Firestore
        try {
          updateDoc(doc(db, 'users', profile.uid), {
            current_lat: latitude,
            current_lng: longitude,
            last_location_update: new Date().toISOString()
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`);
        }
      },
      (err) => console.error("Geolocation error:", err),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );

    // Fetch active patrol
    const unsubPatrol = onSnapshot(
      query(collection(db, 'patrol_sessions'), 
      where('user_id', '==', profile.uid), 
      where('status', '==', 'active')), 
      (snap) => {
        if (!snap.empty) {
          setActivePatrol({ id: snap.docs[0].id, ...snap.docs[0].data() } as PatrolSession);
        } else {
          setActivePatrol(null);
        }
      },
      (error) => handleFirestoreError(error, OperationType.GET, 'patrol_sessions')
    );

    return () => {
      unsubSites();
      unsubPatrol();
      navigator.geolocation.clearWatch(watchId);
    };
  }, [profile.uid, profile.active_site_id]);

  useEffect(() => {
    if (currentLocation && assignedSite) {
      const dist = calculateDistance(
        currentLocation.lat, 
        currentLocation.lng, 
        assignedSite.geofence_lat, 
        assignedSite.geofence_lng
      );
      setDistanceToSite(dist);

      // Alert if out of perimeter while on duty
      if (profile.is_on_duty && dist > assignedSite.geofence_radius) {
        // Trigger alert (throttled in real app)
        try {
          addDoc(collection(db, 'alerts'), {
            user_id: profile.uid,
            site_id: assignedSite.id,
            type: 'perimeter_violation',
            message: `Guardia fuera de perímetro: ${profile.name} está a ${Math.round(dist)}m`,
            timestamp: new Date().toISOString(),
            status: 'new',
            userName: profile.name,
            siteName: assignedSite.name,
            lat: currentLocation.lat,
            lng: currentLocation.lng
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, 'alerts');
        }
      }
    }
  }, [currentLocation, assignedSite, profile.is_on_duty, profile.uid, profile.name]);

  useEffect(() => {
    if (assignedSite) {
      const unsubCP = onSnapshot(query(collection(db, 'checkpoints'), where('site_id', '==', assignedSite.id)), (snap) => {
        setCheckpoints(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Checkpoint)));
      }, (error) => handleFirestoreError(error, OperationType.GET, 'checkpoints'));
      return unsubCP;
    }
  }, [assignedSite]);

  const handleCheckIn = async () => {
    if (!currentLocation || !assignedSite) return;
    
    if (distanceToSite! > assignedSite.geofence_radius) {
      alert(`No puedes marcar entrada. Estás fuera del radio permitido (${Math.round(distanceToSite!)}m de distancia).`);
      return;
    }

    setIsChecking(true);
    try {
      await addDoc(collection(db, 'attendance_logs'), {
        user_id: profile.uid,
        site_id: assignedSite.id,
        type: 'in',
        timestamp: new Date().toISOString(),
        lat: currentLocation.lat,
        lng: currentLocation.lng,
        accuracy: 0,
        userName: profile.name,
        siteName: assignedSite.name
      });
      await updateDoc(doc(db, 'users', profile.uid), { is_on_duty: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'attendance_logs');
    } finally {
      setIsChecking(false);
    }
  };

  const handleCheckOut = async () => {
    if (!currentLocation || !assignedSite) return;

    setIsChecking(true);
    try {
      await addDoc(collection(db, 'attendance_logs'), {
        user_id: profile.uid,
        site_id: assignedSite.id,
        type: 'out',
        timestamp: new Date().toISOString(),
        lat: currentLocation.lat,
        lng: currentLocation.lng,
        accuracy: 0,
        userName: profile.name,
        siteName: assignedSite.name
      });
      await updateDoc(doc(db, 'users', profile.uid), { is_on_duty: false });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'attendance_logs');
    } finally {
      setIsChecking(false);
    }
  };

  const startPatrol = async () => {
    if (!assignedSite) return;
    try {
      await addDoc(collection(db, 'patrol_sessions'), {
        user_id: profile.uid,
        site_id: assignedSite.id,
        start_time: new Date().toISOString(),
        status: 'active',
        visited_checkpoints: [],
        userName: profile.name,
        siteName: assignedSite.name
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'patrol_sessions');
    }
  };

  const markCheckpoint = async (cpId: string) => {
    if (!activePatrol || !currentLocation) return;
    
    const cp = checkpoints.find(c => c.id === cpId);
    if (!cp) return;

    const dist = calculateDistance(currentLocation.lat, currentLocation.lng, cp.lat, cp.lng);
    if (dist > cp.tolerance_radius) {
      alert(`Demasiado lejos del punto de control (${Math.round(dist)}m). Acércate más.`);
      return;
    }

    try {
      const newVisited = [...activePatrol.visited_checkpoints, cpId];
      await updateDoc(doc(db, 'patrol_sessions', activePatrol.id), {
        visited_checkpoints: newVisited
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `patrol_sessions/${activePatrol.id}`);
    }
  };

  const finishPatrol = async () => {
    if (!activePatrol) return;
    try {
      await updateDoc(doc(db, 'patrol_sessions', activePatrol.id), {
        status: 'completed',
        end_time: new Date().toISOString()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `patrol_sessions/${activePatrol.id}`);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4 md:space-y-6">
      <div className="bg-slate-900 text-white p-6 md:p-8 rounded-[2rem] md:rounded-3xl shadow-2xl relative overflow-hidden">
        <div className="relative z-10">
          <p className="text-blue-400 text-[10px] md:text-xs font-bold uppercase tracking-widest mb-1 md:mb-2">Estado del Turno</p>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tighter mb-1">{profile.name}</h2>
          <p className="text-slate-400 text-xs md:text-sm italic font-serif">
            {profile.is_on_duty ? "En servicio activo" : "Fuera de servicio"}
          </p>
          
          <div className="mt-6 md:mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
            {!profile.is_on_duty ? (
              <button 
                onClick={handleCheckIn}
                disabled={isChecking || !assignedSite}
                className="bg-blue-600 hover:bg-blue-500 text-white py-4 md:py-5 rounded-2xl font-bold flex flex-row sm:flex-col items-center justify-center gap-3 md:gap-2 transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-blue-600/20"
              >
                <UserCheck size={24} />
                <span className="text-sm md:text-base">Marcar Entrada</span>
              </button>
            ) : (
              <button 
                onClick={handleCheckOut}
                disabled={isChecking}
                className="bg-rose-600 hover:bg-rose-500 text-white py-4 md:py-5 rounded-2xl font-bold flex flex-row sm:flex-col items-center justify-center gap-3 md:gap-2 transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-rose-600/20"
              >
                <LogOut size={24} />
                <span className="text-sm md:text-base">Marcar Salida</span>
              </button>
            )}
            
            <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700 flex flex-col justify-center">
              <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Sitio Asignado</p>
              <p className="text-sm font-bold truncate">{assignedSite?.name || "No asignado"}</p>
              {distanceToSite !== null && (
                <p className={cn(
                  "text-[10px] mt-1 font-bold",
                  distanceToSite > (assignedSite?.geofence_radius || 0) ? "text-rose-400" : "text-blue-400"
                )}>
                  Distancia: {Math.round(distanceToSite)}m 
                  {assignedSite && distanceToSite > assignedSite.geofence_radius && " (Fuera)"}
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
      </div>

      {profile.is_on_duty && (
        <Card title="Ronda de Vigilancia" subtitle="Escaneo de puntos de control" className="rounded-[2rem]">
          {!activePatrol ? (
            <div className="text-center py-6 md:py-8">
              <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Navigation size={32} />
              </div>
              <h3 className="text-lg font-bold text-slate-900">¿Listo para iniciar ronda?</h3>
              <p className="text-slate-500 text-sm mb-6 px-4">Asegúrate de visitar todos los puntos asignados.</p>
              <button 
                onClick={startPatrol}
                className="w-full sm:w-auto bg-slate-900 text-white px-8 py-4 rounded-2xl font-bold hover:bg-slate-800 transition-all active:scale-95 shadow-xl shadow-slate-900/10"
              >
                Iniciar Nueva Ronda
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex justify-between items-center bg-blue-50 p-4 rounded-2xl border border-blue-100">
                <div className="flex items-center gap-3">
                  <Activity className="text-blue-600 animate-pulse" />
                  <div>
                    <p className="text-[10px] font-bold text-blue-600 uppercase">Ronda en curso</p>
                    <p className="text-xs font-mono text-blue-900">Iniciada: {format(new Date(activePatrol.start_time), 'HH:mm')}</p>
                  </div>
                </div>
                <button 
                  onClick={finishPatrol}
                  className="px-4 py-2 bg-blue-600 text-white text-[10px] font-bold uppercase rounded-xl shadow-md shadow-blue-600/20 active:scale-95"
                >
                  Finalizar
                </button>
              </div>

              <div className="space-y-3">
                {checkpoints.map((cp, idx) => {
                  const isVisited = activePatrol.visited_checkpoints.includes(cp.id);
                  return (
                    <div 
                      key={cp.id}
                      className={cn(
                        "flex items-center justify-between p-4 rounded-2xl border transition-all",
                        isVisited ? "bg-emerald-50 border-emerald-100" : "bg-white border-slate-100"
                      )}
                    >
                      <div className="flex items-center gap-3 md:gap-4">
                        <div className={cn(
                          "w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center font-bold text-xs",
                          isVisited ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"
                        )}>
                          {idx + 1}
                        </div>
                        <div className="min-w-0">
                          <p className={cn("text-sm font-bold truncate", isVisited ? "text-emerald-900" : "text-slate-900")}>{cp.name}</p>
                          <p className="text-[10px] text-slate-400 uppercase">Radio: {cp.tolerance_radius}m</p>
                        </div>
                      </div>
                      {!isVisited && (
                        <button 
                          onClick={() => markCheckpoint(cp.id)}
                          className="bg-slate-900 text-white px-4 py-2.5 rounded-xl text-[10px] font-bold hover:bg-slate-800 active:scale-95 shadow-md shadow-slate-900/10"
                        >
                          Marcar
                        </button>
                      )}
                      {isVisited && (
                        <CheckCircle2 size={24} className="text-emerald-600" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:gap-4">
        <Card className="p-4 text-center rounded-3xl">
          <LocateFixed size={20} className="mx-auto mb-2 text-slate-400" />
          <p className="text-[10px] font-bold text-slate-500 uppercase">Mi Ubicación</p>
          <p className="text-[10px] font-mono mt-1 truncate">
            {currentLocation ? `${currentLocation.lat.toFixed(4)}, ${currentLocation.lng.toFixed(4)}` : "Obteniendo..."}
          </p>
        </Card>
        <Card className="p-4 text-center rounded-3xl">
          <History size={20} className="mx-auto mb-2 text-slate-400" />
          <p className="text-[10px] font-bold text-slate-500 uppercase">Última Ronda</p>
          <p className="text-[10px] font-bold mt-1">Reciente</p>
        </Card>
      </div>
    </div>
  );
};

const SidebarItem = ({ to, icon: Icon, label, active }: { to: string, icon: any, label: string, active: boolean }) => (
  <Link
    to={to}
    className={cn(
      "flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors rounded-lg",
      active 
        ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" 
        : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
    )}
  >
    <Icon size={18} />
    <span>{label}</span>
  </Link>
);

const MobileNavItem = ({ to, icon: Icon, label, active, onClick }: { to: string, icon: any, label: string, active: boolean, onClick: () => void }) => (
  <Link
    to={to}
    onClick={onClick}
    className={cn(
      "flex items-center gap-4 px-5 py-4 text-lg font-bold transition-all rounded-2xl",
      active 
        ? "bg-blue-600 text-white shadow-xl shadow-blue-600/20 scale-[1.02]" 
        : "text-slate-400 bg-slate-900/50 border border-slate-800"
    )}
  >
    <Icon size={24} />
    <span>{label}</span>
  </Link>
);

const Card = ({ children, title, subtitle, className, ...props }: { children: React.ReactNode, title?: string, subtitle?: string, className?: string, [key: string]: any }) => (
  <div className={cn("bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm", className)} {...props}>
    {(title || subtitle) && (
      <div className="px-6 py-4 border-bottom border-slate-100 bg-slate-50/50">
        {title && <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider">{title}</h3>}
        {subtitle && <p className="text-xs text-slate-500 mt-1 italic font-serif">{subtitle}</p>}
      </div>
    )}
    <div className="p-6">{children}</div>
  </div>
);

const ConfirmModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title, 
  message 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onConfirm: () => void; 
  title: string; 
  message: string; 
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-sm">
      <div className="max-w-md w-full bg-white rounded-3xl p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in duration-200">
        <div className="flex items-center gap-3 mb-4 text-rose-600">
          <AlertTriangle size={24} />
          <h3 className="text-xl font-bold">{title}</h3>
        </div>
        <p className="text-slate-600 mb-8">{message}</p>
        <div className="flex gap-3 justify-end">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-slate-500 font-bold uppercase text-xs hover:bg-slate-50 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button 
            onClick={() => { onConfirm(); onClose(); }}
            className="px-6 py-2 bg-rose-600 text-white font-bold uppercase text-xs rounded-lg hover:bg-rose-700 shadow-lg shadow-rose-200 transition-all"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ label, value, icon: Icon, color, trend }: any) => (
  <Card className="p-4 md:p-6 relative overflow-hidden group hover:shadow-xl transition-all duration-300 border-none bg-white shadow-md rounded-[1.5rem] md:rounded-3xl">
    <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-2 md:gap-4">
      <div>
        <p className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">{label}</p>
        <div className="flex items-baseline gap-2">
          <h3 className="text-2xl md:text-4xl font-black text-slate-900 tracking-tighter">{value}</h3>
          {trend && <span className="text-[10px] font-bold text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded">+{trend}</span>}
        </div>
      </div>
      <div className={cn("p-3 md:p-4 rounded-2xl text-white shadow-lg transition-transform group-hover:scale-110", color)}>
        <Icon size={20} className="md:w-6 md:h-6" />
      </div>
    </div>
    <div className={cn("absolute -bottom-4 -right-4 w-24 h-24 rounded-full opacity-5 blur-2xl", color)} />
  </Card>
);

// --- Pages ---

const Login = ({ setLoading, setUser, setProfile }: { setLoading: (v: boolean) => void, setUser: (u: any) => void, setProfile: (p: any) => void }) => {
  const handleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      
      // Check if user exists in Firestore, if not create as guard by default
      const userRef = doc(db, 'users', user.uid);
      let userSnap;
      try {
        userSnap = await getDoc(userRef);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
        return;
      }
      
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          name: user.displayName || 'Usuario',
          role: user.email === 'angelotorresdiaz@gmail.com' ? 'admin' : 'guard',
          createdAt: new Date().toISOString()
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'users');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="flex flex-col items-center">
          <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-blue-500/20 mb-6 transform -rotate-6">
            <Shield size={40} className="text-white" />
          </div>
          <h1 className="text-4xl font-bold text-white tracking-tighter uppercase italic font-serif">
            Langarica <span className="text-blue-500">Security</span>
          </h1>
          <p className="text-slate-400 mt-2 text-sm uppercase tracking-[0.2em] font-mono">
            Control de Rondas Rurales
          </p>
        </div>

        <div className="bg-slate-900/50 border border-slate-800 p-8 rounded-2xl backdrop-blur-xl">
          <h2 className="text-xl font-semibold text-white mb-6">Acceso Administrativo</h2>
          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 bg-white text-slate-950 font-bold py-3 px-6 rounded-xl hover:bg-slate-200 transition-all active:scale-95 shadow-lg"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
            Continuar con Google
          </button>

          <div className="flex gap-3 mt-4">
            <button
              onClick={() => {
                const demoUser = {
                  uid: 'demo-admin',
                  email: 'admin@demo.com',
                  name: 'Admin Demo',
                  role: 'admin' as UserRole,
                  createdAt: new Date().toISOString()
                };
                setUser({ uid: 'demo-admin', displayName: 'Admin Demo', email: 'admin@demo.com' });
                setProfile(demoUser);
                setLoading(false);
              }}
              className="flex-1 bg-slate-800 text-slate-300 text-[10px] font-bold py-2 rounded-lg hover:bg-slate-700 transition-all uppercase"
            >
              Demo Admin
            </button>
            <button
              onClick={() => {
                const demoUser = {
                  uid: 'demo-guard',
                  email: 'guardia@demo.com',
                  name: 'Guardia Demo',
                  role: 'guard' as UserRole,
                  is_on_duty: false,
                  createdAt: new Date().toISOString()
                };
                setUser({ uid: 'demo-guard', displayName: 'Guardia Demo', email: 'guardia@demo.com' });
                setProfile(demoUser);
                setLoading(false);
              }}
              className="flex-1 bg-slate-800 text-slate-300 text-[10px] font-bold py-2 rounded-lg hover:bg-slate-700 transition-all uppercase"
            >
              Demo Guardia
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-6 leading-relaxed">
            Al ingresar, aceptas los términos de servicio y la política de privacidad de Langarica Security.
          </p>
        </div>
      </div>
    </div>
  );
};

const Dashboard = () => {
  const [stats, setStats] = useState({
    activeGuards: 0,
    sites: 0,
    patrolsToday: 0,
    alerts: 0
  });

  const [recentPatrols, setRecentPatrols] = useState<PatrolSession[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);

  useEffect(() => {
    // Real-time stats
    const unsubUsers = onSnapshot(query(collection(db, 'users'), where('is_on_duty', '==', true)), (snap) => {
      setStats(prev => ({ ...prev, activeGuards: snap.size }));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'users'));
    const unsubSites = onSnapshot(collection(db, 'sites'), (snap) => {
      setStats(prev => ({ ...prev, sites: snap.size }));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'sites'));
    const unsubPatrolsToday = onSnapshot(query(collection(db, 'patrol_sessions'), where('status', '==', 'completed')), (snap) => {
      // In a real app we'd filter by today's date in the query
      setStats(prev => ({ ...prev, patrolsToday: snap.size }));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'patrol_sessions'));
    const unsubAlerts = onSnapshot(query(collection(db, 'alerts'), where('status', '==', 'new')), (snap) => {
      setStats(prev => ({ ...prev, alerts: snap.size }));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'alerts'));
    const unsubRecentPatrols = onSnapshot(query(collection(db, 'patrol_sessions'), orderBy('start_time', 'desc'), limit(5)), (snap) => {
      const patrols = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as PatrolSession));
      setRecentPatrols(patrols);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'patrol_sessions'));

    // Mock chart data for visualization
    setChartData([
      { name: 'Lun', rondas: 12 },
      { name: 'Mar', rondas: 19 },
      { name: 'Mie', rondas: 15 },
      { name: 'Jue', rondas: 22 },
      { name: 'Vie', rondas: 30 },
      { name: 'Sab', rondas: 25 },
      { name: 'Dom', rondas: 18 },
    ]);

    return () => {
      unsubUsers();
      unsubSites();
      unsubPatrolsToday();
      unsubAlerts();
      unsubRecentPatrols();
    };
  }, []);

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">Panel de Control</h2>
          <p className="text-slate-500 text-sm italic font-serif">Vista general de operaciones en tiempo real</p>
        </div>
        <div className="text-left sm:text-right w-full sm:w-auto">
          <p className="text-[10px] font-mono text-slate-400 uppercase tracking-widest bg-slate-100 sm:bg-transparent p-2 sm:p-0 rounded-lg">
            {format(new Date(), 'EEEE, d MMMM yyyy', { locale: es })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
        <StatCard label="Guardias" value={stats.activeGuards} icon={Users} color="bg-blue-600" />
        <StatCard label="Sitios" value={stats.sites} icon={MapPin} color="bg-emerald-600" />
        <StatCard label="Rondas" value={stats.patrolsToday} icon={Navigation} color="bg-indigo-600" />
        <StatCard label="Alertas" value={stats.alerts} icon={AlertTriangle} color="bg-rose-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Actividad Semanal" subtitle="Rondas completadas por día" className="lg:col-span-2">
          <div className="h-[300px] w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <Tooltip 
                  cursor={{ fill: '#f8fafc' }}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="rondas" fill="#2563eb" radius={[4, 4, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Rondas Recientes" subtitle="Últimas sesiones registradas">
          <div className="space-y-4 mt-4">
            {recentPatrols.length === 0 ? (
              <p className="text-sm text-slate-400 italic text-center py-8">No hay rondas recientes</p>
            ) : (
              recentPatrols.map((patrol) => (
                <div key={patrol.id} className="flex items-center gap-4 p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors">
                  <div className={cn(
                    "w-2 h-10 rounded-full",
                    patrol.status === 'completed' ? "bg-emerald-500" : patrol.status === 'partial' ? "bg-amber-500" : "bg-rose-500"
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">Guardia #{patrol.user_id.slice(0, 4)}</p>
                    <p className="text-xs text-slate-500 font-mono">{patrol.start_time?.toDate ? format(patrol.start_time.toDate(), 'HH:mm') : '...'}</p>
                  </div>
                  <div className="text-right">
                    <span className={cn(
                      "text-[10px] font-bold uppercase px-2 py-1 rounded-full",
                      patrol.status === 'completed' ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                    )}>
                      {patrol.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};

const CheckpointManager = ({ siteId, siteName }: { siteId: string, siteName: string }) => {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newCP, setNewCP] = useState({ name: '', lat: '', lng: '', radius: '20' });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'checkpoints'), where('site_id', '==', siteId)), (snap) => {
      setCheckpoints(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Checkpoint)));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'checkpoints'));
    return unsub;
  }, [siteId]);

  const handleAddCP = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'checkpoints'), {
        site_id: siteId,
        name: newCP.name,
        lat: Number(newCP.lat),
        lng: Number(newCP.lng),
        tolerance_radius: Number(newCP.radius),
        createdAt: new Date().toISOString()
      });
      setIsAdding(false);
      setNewCP({ name: '', lat: '', lng: '', radius: '20' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'checkpoints');
    }
  };

  const handleDeleteCP = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'checkpoints', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `checkpoints/${id}`);
    }
  };

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <div className="flex justify-between items-center mb-4">
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
          <Target size={14} className="text-blue-500" />
          Puntos de Control ({checkpoints.length})
        </h4>
        <button 
          onClick={() => setIsAdding(!isAdding)}
          className="text-[10px] font-bold text-blue-600 uppercase hover:underline"
        >
          {isAdding ? "Cancelar" : "Añadir Punto"}
        </button>
      </div>

      {isAdding && (
        <form onSubmit={handleAddCP} className="bg-slate-50 p-3 rounded-lg mb-4 space-y-3 border border-slate-200">
          <input 
            required
            type="text" 
            placeholder="Nombre del punto (ej: Portón Principal)"
            value={newCP.name}
            onChange={e => setNewCP({...newCP, name: e.target.value})}
            className="w-full px-2 py-1 text-xs border border-slate-200 rounded outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input 
              required
              type="text" 
              placeholder="Lat"
              value={newCP.lat}
              onChange={e => setNewCP({...newCP, lat: e.target.value})}
              className="px-2 py-1 text-[10px] border border-slate-200 rounded font-mono"
            />
            <input 
              required
              type="text" 
              placeholder="Lng"
              value={newCP.lng}
              onChange={e => setNewCP({...newCP, lng: e.target.value})}
              className="px-2 py-1 text-[10px] border border-slate-200 rounded font-mono"
            />
            <input 
              required
              type="text" 
              placeholder="Rad (m)"
              value={newCP.radius}
              onChange={e => setNewCP({...newCP, radius: e.target.value})}
              className="px-2 py-1 text-[10px] border border-slate-200 rounded font-mono"
            />
          </div>
          <button type="submit" className="w-full bg-blue-600 text-white py-1.5 rounded text-[10px] font-bold uppercase hover:bg-blue-700">
            Confirmar Punto
          </button>
        </form>
      )}

      <div className="space-y-2">
        {checkpoints.map(cp => (
          <div key={cp.id} className="flex justify-between items-center bg-white p-2 rounded border border-slate-100 text-[10px]">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
              <span className="font-bold text-slate-700">{cp.name}</span>
              <span className="text-slate-400 font-mono">({cp.lat.toFixed(4)}, {cp.lng.toFixed(4)})</span>
            </div>
            <button onClick={() => setConfirmDelete(cp.id)} className="text-rose-400 hover:text-rose-600">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      <ConfirmModal 
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDeleteCP(confirmDelete)}
        title="Eliminar Punto"
        message="¿Está seguro de que desea eliminar este punto de control?"
      />
    </div>
  );
};

const Sites = () => {
  const [sites, setSites] = useState<Site[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [mapsUrl, setMapsUrl] = useState('');

  useEffect(() => {
    if (editingSite) {
      setFormSite({
        name: editingSite.name,
        lat: editingSite.geofence_lat.toString(),
        lng: editingSite.geofence_lng.toString(),
        radius: editingSite.geofence_radius.toString()
      });
    }
  }, [editingSite]);

  useEffect(() => {
    if (isAdding && !editingSite) {
      setFormSite({ name: '', lat: '', lng: '', radius: '100' });
    }
  }, [isAdding, editingSite]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'sites'), (snap) => {
      setSites(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Site)));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'sites'));
    return unsub;
  }, []);

  const extractCoords = (url: string) => {
    console.log("Extracting coords from:", url);
    
    // Pattern 1: /@(-?\d+\.\d+),(-?\d+\.\d+)
    const pattern1 = /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/;
    const match1 = url.match(pattern1);
    if (match1) return { lat: parseFloat(match1[1]), lng: parseFloat(match1[2]) };

    // Pattern 2: !3d(-?\d+\.\d+)!4d(-?\d+\.\d+)
    const pattern2 = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/;
    const match2 = url.match(pattern2);
    if (match2) return { lat: parseFloat(match2[1]), lng: parseFloat(match2[2]) };

    // Pattern 3: ll=(-?\d+\.\d+),(-?\d+\.\d+)
    const pattern3 = /ll=(-?\d+\.\d+),\s*(-?\d+\.\d+)/;
    const match3 = url.match(pattern3);
    if (match3) return { lat: parseFloat(match3[1]), lng: parseFloat(match3[2]) };

    // Pattern 4: q=(-?\d+\.\d+),(-?\d+\.\d+)
    const pattern4 = /q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/;
    const match4 = url.match(pattern4);
    if (match4) return { lat: parseFloat(match4[1]), lng: parseFloat(match4[2]) };

    // Pattern 5: /(-?\d+\.\d+),(-?\d+\.\d+)/
    const pattern5 = /\/(-?\d+\.\d+),\s*(-?\d+\.\d+)/;
    const match5 = url.match(pattern5);
    if (match5) return { lat: parseFloat(match5[1]), lng: parseFloat(match5[2]) };

    // Pattern 6: Any pair of numbers separated by a comma
    const pattern6 = /(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/g;
    let match;
    while ((match = pattern6.exec(url)) !== null) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng };
      }
    }

    return null;
  };

  const [isResolving, setIsResolving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Form state as strings to allow typing negative signs and decimals
  const [formSite, setFormSite] = useState({ name: '', lat: '', lng: '', radius: '100' });

  const handleUrlChange = async (url: string) => {
    setMapsUrl(url);
    console.log("URL changed:", url);
    
    // Check if it's a shortened URL
    if (url.includes('maps.app.goo.gl') || url.includes('goo.gl/maps')) {
      setIsResolving(true);
      try {
        const response = await fetch('/api/resolve-maps-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const data = await response.json();
        console.log("Resolved URL data:", data);
        if (data.finalUrl) {
          const coords = extractCoords(data.finalUrl);
          console.log("Extracted coords:", coords);
          if (coords) {
            setFormSite(prev => ({ ...prev, lat: coords.lat.toString(), lng: coords.lng.toString() }));
          }
        }
      } catch (error) {
        console.error("Error resolving shortened URL:", error);
      } finally {
        setIsResolving(false);
      }
    } else {
      const coords = extractCoords(url);
      if (coords) {
        setFormSite(prev => ({ ...prev, lat: coords.lat.toString(), lng: coords.lng.toString() }));
      }
    }
  };

  const handleAddSite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingSite) {
        await updateDoc(doc(db, 'sites', editingSite.id), {
          name: formSite.name,
          geofence_lat: Number(formSite.lat),
          geofence_lng: Number(formSite.lng),
          geofence_radius: Number(formSite.radius),
          updatedAt: new Date().toISOString()
        });
        setEditingSite(null);
      } else {
        await addDoc(collection(db, 'sites'), {
          name: formSite.name,
          geofence_lat: Number(formSite.lat),
          geofence_lng: Number(formSite.lng),
          geofence_radius: Number(formSite.radius),
          createdAt: new Date().toISOString()
        });
        setIsAdding(false);
      }
      setFormSite({ name: '', lat: '', lng: '', radius: '100' });
      setMapsUrl('');
    } catch (error) {
      handleFirestoreError(error, editingSite ? OperationType.UPDATE : OperationType.CREATE, editingSite ? `sites/${editingSite.id}` : 'sites');
    }
  };

  const handleDeleteSite = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'sites', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `sites/${id}`);
    }
  };

  const handleViewMap = (site: Site) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${site.geofence_lat},${site.geofence_lng}`;
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Gestión de Sitios</h2>
          <p className="text-slate-500 italic font-serif">Configuración de geocercas y perímetros</p>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-slate-800 transition-all"
        >
          <Plus size={18} />
          Nuevo Sitio
        </button>
      </div>

      {(isAdding || editingSite) && (
        <Card title={editingSite ? "Editar Sitio" : "Agregar Nuevo Sitio"} className="border-blue-200 bg-blue-50/30">
          <form onSubmit={handleAddSite} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Nombre del Sitio</label>
                <input 
                  required
                  type="text" 
                  value={formSite.name}
                  onChange={e => setFormSite({...formSite, name: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Ej: Fundo Los Olivos"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Link de Google Maps (Auto-completar)</label>
                <div className="relative">
                  <input 
                    type="text" 
                    value={mapsUrl}
                    onChange={e => handleUrlChange(e.target.value)}
                    className={cn(
                      "w-full pl-10 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all",
                      isResolving && "bg-slate-50 opacity-70 cursor-wait"
                    )}
                    placeholder={isResolving ? "Resolviendo coordenadas..." : "Pegue el link o coordenadas aquí"}
                    disabled={isResolving}
                  />
                  {isResolving ? (
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <MapIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Latitud</label>
                <input 
                  required
                  type="text" 
                  value={formSite.lat}
                  onChange={e => setFormSite({...formSite, lat: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono"
                  placeholder="-34.1234"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Longitud</label>
                <input 
                  required
                  type="text" 
                  value={formSite.lng}
                  onChange={e => setFormSite({...formSite, lng: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono"
                  placeholder="-71.1234"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Radio (m)</label>
                <input 
                  required
                  type="text" 
                  value={formSite.radius}
                  onChange={e => setFormSite({...formSite, radius: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono"
                />
              </div>
              <div className="flex items-end gap-2">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 font-bold text-sm flex items-center justify-center gap-2">
                  <CheckCircle2 size={18} />
                  {editingSite ? "Actualizar" : "Guardar Sitio"}
                </button>
                <button type="button" onClick={() => { setIsAdding(false); setEditingSite(null); setMapsUrl(''); }} className="bg-slate-200 text-slate-600 p-2 rounded-lg hover:bg-slate-300">
                  <X size={20} />
                </button>
              </div>
            </div>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {sites.map(site => (
          <Card key={site.id} className="group hover:border-blue-300 transition-all">
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-slate-100 rounded-xl group-hover:bg-blue-100 transition-colors">
                <MapPin size={24} className="text-slate-600 group-hover:text-blue-600" />
              </div>
              <span className="text-[10px] font-mono text-slate-400">ID: {site.id.slice(0, 8)}</span>
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-1">{site.name}</h3>
            <div className="space-y-2 mt-4">
              <div className="flex justify-between text-xs border-b border-slate-50 pb-2">
                <span className="text-slate-500 uppercase font-bold">Coordenadas</span>
                <span className="font-mono text-slate-700">{site.geofence_lat.toFixed(4)}, {site.geofence_lng.toFixed(4)}</span>
              </div>
              <div className="flex justify-between text-xs border-b border-slate-50 pb-2">
                <span className="text-slate-500 uppercase font-bold">Radio Geocerca</span>
                <span className="font-mono text-slate-700">{site.geofence_radius}m</span>
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <button 
                onClick={() => handleViewMap(site)}
                className="flex-1 text-xs font-bold uppercase py-2 bg-slate-50 text-slate-600 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1"
              >
                <Eye size={14} />
                Ver Mapa
              </button>
              <button 
                onClick={() => { setEditingSite(site); setIsAdding(false); }}
                className="flex-1 text-xs font-bold uppercase py-2 bg-slate-50 text-slate-600 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1"
              >
                <Edit3 size={14} />
                Editar
              </button>
              <button 
                onClick={() => setConfirmDelete(site.id)}
                className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
            
            <CheckpointManager siteId={site.id} siteName={site.name} />
          </Card>
        ))}
      </div>

      <ConfirmModal 
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDeleteSite(confirmDelete)}
        title="Eliminar Sitio"
        message="¿Está seguro de que desea eliminar este sitio? Esta acción no se puede deshacer."
      />
    </div>
  );
};

const Guards = () => {
  const [guards, setGuards] = useState<UserProfile[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newGuard, setNewGuard] = useState({ name: '', email: '', role: 'guard' as UserRole, site_id: '' });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    const unsubGuards = onSnapshot(collection(db, 'users'), (snap) => {
      setGuards(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'users'));
    const unsubSites = onSnapshot(collection(db, 'sites'), (snap) => {
      setSites(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Site)));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'sites'));
    return () => {
      unsubGuards();
      unsubSites();
    };
  }, []);

  const handleAddGuard = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'users'), {
        name: newGuard.name,
        email: newGuard.email,
        role: newGuard.role,
        active_site_id: newGuard.site_id || null,
        createdAt: new Date().toISOString(),
        is_on_duty: false
      });
      setIsAdding(false);
      setNewGuard({ name: '', email: '', role: 'guard', site_id: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'users');
    }
  };

  const handleUpdateSite = async (uid: string, siteId: string) => {
    try {
      await updateDoc(doc(db, 'users', uid), { active_site_id: siteId || null });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const handleDeleteGuard = async (uid: string) => {
    try {
      await deleteDoc(doc(db, 'users', uid));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${uid}`);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Personal de Seguridad</h2>
          <p className="text-slate-500 italic font-serif">Gestión de guardias y supervisores</p>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-slate-800 transition-all"
        >
          <Plus size={18} />
          Añadir Nuevo Guardia
        </button>
      </div>

      {isAdding && (
        <Card title="Añadir Nuevo Personal" className="border-blue-200 bg-blue-50/30">
          <form onSubmit={handleAddGuard} className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Nombre Completo</label>
              <input 
                required
                type="text" 
                value={newGuard.name}
                onChange={e => setNewGuard({...newGuard, name: e.target.value})}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="Ej: Juan Pérez"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Email</label>
              <input 
                required
                type="email" 
                value={newGuard.email}
                onChange={e => setNewGuard({...newGuard, email: e.target.value})}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="juan@langarica.com"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Rol</label>
              <select 
                value={newGuard.role}
                onChange={e => setNewGuard({...newGuard, role: e.target.value as UserRole})}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                <option value="guard">Guardia</option>
                <option value="supervisor">Supervisor</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Sitio Asignado</label>
              <select 
                value={newGuard.site_id}
                onChange={e => setNewGuard({...newGuard, site_id: e.target.value})}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                <option value="">Sin asignar</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 font-bold text-sm flex items-center justify-center gap-2">
                <CheckCircle2 size={18} />
                Guardar
              </button>
              <button type="button" onClick={() => setIsAdding(false)} className="bg-slate-200 text-slate-600 p-2 rounded-lg hover:bg-slate-300">
                <X size={20} />
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-0 overflow-hidden rounded-[1.5rem] md:rounded-3xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Nombre / Email</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Rol</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Sitio Asignado</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Estado</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {guards.map(guard => (
                <tr key={guard.uid} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold">
                        {guard.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900">{guard.name}</p>
                        <p className="text-xs text-slate-500 font-mono">{guard.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "text-[10px] font-bold uppercase px-2 py-1 rounded-full",
                      guard.role === 'admin' ? "bg-purple-100 text-purple-700" : guard.role === 'supervisor' ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700"
                    )}>
                      {guard.role}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <select 
                      value={guard.active_site_id || ''}
                      onChange={e => handleUpdateSite(guard.uid, e.target.value)}
                      className="text-xs border-none bg-transparent focus:ring-0 font-bold text-slate-600 cursor-pointer hover:text-blue-600"
                    >
                      <option value="">Sin asignar</option>
                      {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        guard.is_on_duty ? "bg-emerald-500 animate-pulse" : "bg-slate-300"
                      )} />
                      <span className={cn(
                        "text-xs font-bold uppercase",
                        guard.is_on_duty ? "text-emerald-600" : "text-slate-400"
                      )}>
                        {guard.is_on_duty ? "Activo" : "Inactivo"}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <button className="text-blue-600 hover:text-blue-800 text-xs font-bold uppercase">Gestionar</button>
                      <button 
                        onClick={() => setConfirmDelete(guard.uid)}
                        className="text-red-600 hover:text-red-800 text-xs font-bold uppercase ml-4"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ConfirmModal 
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDeleteGuard(confirmDelete)}
        title="Eliminar Guardia"
        message="¿Está seguro de que desea eliminar este guardia? Esta acción no se puede deshacer."
      />
    </div>
  );
};

const Layout = ({ children, user, profile }: { children: React.ReactNode, user: FirebaseUser, profile: UserProfile }) => {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const isAdmin = profile.role === 'admin' || profile.role === 'supervisor';

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 bg-slate-950 text-white p-6 fixed h-full">
        <div className="flex items-center gap-3 mb-10 px-2">
          <div className="p-2 bg-blue-600 rounded-lg shadow-lg shadow-blue-600/20">
            <Shield size={20} />
          </div>
          <h1 className="text-xl font-bold tracking-tighter uppercase italic font-serif">Langarica</h1>
        </div>

        <nav className="flex-1 space-y-2">
          {isAdmin ? (
            <>
              <SidebarItem to="/" icon={LayoutDashboard} label="Dashboard" active={location.pathname === '/'} />
              <SidebarItem to="/monitoring" icon={Activity} label="Monitoreo" active={location.pathname === '/monitoring'} />
              <SidebarItem to="/guards" icon={Users} label="Guardias" active={location.pathname === '/guards'} />
              <SidebarItem to="/sites" icon={MapPin} label="Sitios y Geocercas" active={location.pathname === '/sites'} />
              <SidebarItem to="/patrols" icon={Navigation} label="Rondas" active={location.pathname === '/patrols'} />
              <SidebarItem to="/attendance" icon={Clock} label="Asistencia" active={location.pathname === '/attendance'} />
              <SidebarItem to="/alerts" icon={Bell} label="Alertas" active={location.pathname === '/alerts'} />
            </>
          ) : (
            <>
              <SidebarItem to="/" icon={LayoutDashboard} label="Mi Turno" active={location.pathname === '/'} />
            </>
          )}
        </nav>

        <div className="mt-auto pt-6 border-t border-slate-800">
          <div className="flex items-center gap-3 px-2 mb-6">
            <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700 overflow-hidden">
              {user.photoURL ? <img src={user.photoURL} className="w-full h-full object-cover" alt="User" /> : <Users size={20} />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold truncate">{user.displayName}</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">{profile.role}</p>
            </div>
          </div>
          <button 
            onClick={() => signOut(auth)}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
          >
            <LogOut size={18} />
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-md p-6 flex flex-col animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex justify-between items-center mb-10">
            <div className="flex items-center gap-2">
              <Shield className="text-blue-600" />
              <h1 className="text-xl font-bold text-white italic font-serif">Langarica</h1>
            </div>
            <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 text-white bg-slate-800 rounded-lg">
              <X />
            </button>
          </div>
          
          <nav className="flex-1 space-y-4 overflow-y-auto">
            {isAdmin ? (
              <>
                <MobileNavItem to="/" icon={LayoutDashboard} label="Dashboard" onClick={() => setIsMobileMenuOpen(false)} active={location.pathname === '/'} />
                <MobileNavItem to="/monitoring" icon={Activity} label="Monitoreo" onClick={() => setIsMobileMenuOpen(false)} active={location.pathname === '/monitoring'} />
                <MobileNavItem to="/guards" icon={Users} label="Guardias" onClick={() => setIsMobileMenuOpen(false)} active={location.pathname === '/guards'} />
                <MobileNavItem to="/sites" icon={MapPin} label="Sitios y Geocercas" onClick={() => setIsMobileMenuOpen(false)} active={location.pathname === '/sites'} />
                <MobileNavItem to="/patrols" icon={Navigation} label="Rondas" onClick={() => setIsMobileMenuOpen(false)} active={location.pathname === '/patrols'} />
                <MobileNavItem to="/attendance" icon={Clock} label="Asistencia" onClick={() => setIsMobileMenuOpen(false)} active={location.pathname === '/attendance'} />
                <MobileNavItem to="/alerts" icon={Bell} label="Alertas" onClick={() => setIsMobileMenuOpen(false)} active={location.pathname === '/alerts'} />
              </>
            ) : (
              <>
                <MobileNavItem to="/" icon={LayoutDashboard} label="Mi Turno" onClick={() => setIsMobileMenuOpen(false)} active={location.pathname === '/'} />
              </>
            )}
          </nav>

          <div className="mt-auto pt-6 border-t border-slate-800">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700 overflow-hidden">
                {user.photoURL ? <img src={user.photoURL} className="w-full h-full object-cover" alt="User" /> : <Users size={24} className="text-slate-400" />}
              </div>
              <div>
                <p className="text-white font-bold">{user.displayName}</p>
                <p className="text-xs text-slate-500 uppercase tracking-widest">{profile.role}</p>
              </div>
            </div>
            <button 
              onClick={() => signOut(auth)}
              className="w-full flex items-center justify-center gap-3 px-4 py-4 bg-rose-500/10 text-rose-400 font-bold rounded-xl transition-colors"
            >
              <LogOut size={20} />
              Cerrar Sesión
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 lg:ml-64 p-4 md:p-8 lg:p-12 min-w-0">
        {/* Mobile Header */}
        <header className="lg:hidden flex items-center justify-between mb-6 sticky top-0 z-40 bg-slate-50/80 backdrop-blur-sm py-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-600 rounded-lg shadow-lg shadow-blue-500/20">
              <Shield size={18} className="text-white" />
            </div>
            <h1 className="text-lg font-bold italic font-serif tracking-tight">Langarica</h1>
          </div>
          <button onClick={() => setIsMobileMenuOpen(true)} className="p-2.5 bg-white rounded-xl border border-slate-200 shadow-sm active:scale-95 transition-transform">
            <Menu size={20} />
          </button>
        </header>

        {children}
      </main>
    </div>
  );
};

const Monitoring = () => {
  const [activeGuards, setActiveGuards] = useState<UserProfile[]>([]);
  const [sites, setSites] = useState<Site[]>([]);

  useEffect(() => {
    const unsubGuards = onSnapshot(query(collection(db, 'users'), where('is_on_duty', '==', true)), (snap) => {
      setActiveGuards(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'users'));
    const unsubSites = onSnapshot(collection(db, 'sites'), (snap) => {
      setSites(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Site)));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'sites'));
    return () => {
      unsubGuards();
      unsubSites();
    };
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Monitoreo en Tiempo Real</h2>
        <p className="text-slate-500 italic font-serif">Ubicación y estado de guardias activos</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-2 h-[400px] md:h-[600px] flex items-center justify-center bg-slate-100 relative overflow-hidden">
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
          
          {/* Simulated Map View */}
          <div className="relative w-full h-full p-12">
            {sites.map(site => (
              <div 
                key={site.id}
                className="absolute w-32 h-32 border-2 border-blue-500/30 bg-blue-500/5 rounded-full flex items-center justify-center"
                style={{ 
                  left: `${((site.geofence_lng + 180) % 1) * 100}%`, 
                  top: `${((90 - site.geofence_lat) % 1) * 100}%` 
                }}
              >
                <span className="text-[8px] font-bold text-blue-600 uppercase text-center px-2">{site.name}</span>
              </div>
            ))}

            {activeGuards.map(guard => (
              <div 
                key={guard.uid}
                className="absolute group"
                style={{ 
                  left: `${((guard.current_lng! + 180) % 1) * 100}%`, 
                  top: `${((90 - guard.current_lat!) % 1) * 100}%` 
                }}
              >
                <div className="w-4 h-4 bg-emerald-500 rounded-full border-2 border-white shadow-lg animate-pulse" />
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-900 text-white text-[10px] py-1 px-2 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                  {guard.name}
                </div>
              </div>
            ))}
          </div>

          <div className="absolute bottom-6 right-6 bg-white/90 backdrop-blur p-4 rounded-xl border border-slate-200 shadow-xl text-xs space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-emerald-500 rounded-full" />
              <span className="font-bold">Guardia Activo</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500/30 border border-blue-500 rounded-full" />
              <span className="font-bold">Perímetro de Sitio</span>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Personal Activo ({activeGuards.length})</h3>
          {activeGuards.map(guard => (
            <Card key={guard.uid} className="p-4 border-l-4 border-l-emerald-500">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-bold text-slate-900">{guard.name}</p>
                  <p className="text-[10px] text-slate-500 uppercase">{guard.email}</p>
                </div>
                <div className="px-2 py-1 bg-emerald-50 text-emerald-600 text-[8px] font-bold rounded uppercase">En Turno</div>
              </div>
              <div className="mt-4 flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                <LocateFixed size={12} />
                {guard.current_lat?.toFixed(4)}, {guard.current_lng?.toFixed(4)}
              </div>
            </Card>
          ))}
          {activeGuards.length === 0 && (
            <div className="text-center py-12 text-slate-400 italic text-sm">No hay personal activo en este momento.</div>
          )}
        </div>
      </div>
    </div>
  );
};

const PatrolsHistory = () => {
  const [patrols, setPatrols] = useState<PatrolSession[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'patrol_sessions'), orderBy('start_time', 'desc')), (snap) => {
      setPatrols(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as PatrolSession)));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'patrol_sessions'));
    return unsub;
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Historial de Rondas</h2>
        <p className="text-slate-500 italic font-serif">Registro detallado de patrullajes</p>
      </div>

      <Card className="p-0 overflow-hidden rounded-[1.5rem] md:rounded-3xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px] md:min-w-0">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Guardia</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Sitio</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Inicio</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Fin</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Puntos</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
            {patrols.map(patrol => (
              <tr key={patrol.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <p className="text-sm font-bold text-slate-900">{patrol.userName}</p>
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm text-slate-600">{patrol.siteName}</p>
                </td>
                <td className="px-6 py-4">
                  <p className="text-xs font-mono text-slate-500">{format(new Date(patrol.start_time), 'dd/MM HH:mm')}</p>
                </td>
                <td className="px-6 py-4">
                  <p className="text-xs font-mono text-slate-500">{patrol.end_time ? format(new Date(patrol.end_time), 'HH:mm') : '-'}</p>
                </td>
                <td className="px-6 py-4">
                  <span className="text-xs font-bold text-slate-700">{patrol.visited_checkpoints.length} puntos</span>
                </td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "px-2 py-1 rounded text-[8px] font-bold uppercase",
                    patrol.status === 'completed' ? "bg-emerald-50 text-emerald-600" : 
                    patrol.status === 'active' ? "bg-blue-50 text-blue-600 animate-pulse" : "bg-slate-50 text-slate-500"
                  )}>
                    {patrol.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
    </div>
  );
};

const AttendanceHistory = () => {
  const [logs, setLogs] = useState<AttendanceLog[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'attendance_logs'), orderBy('timestamp', 'desc')), (snap) => {
      setLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AttendanceLog)));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'attendance_logs'));
    return unsub;
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Registro de Asistencia</h2>
        <p className="text-slate-500 italic font-serif">Entradas y salidas del personal</p>
      </div>

      <Card className="p-0 overflow-hidden rounded-[1.5rem] md:rounded-3xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px] md:min-w-0">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Guardia</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Sitio</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Tipo</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Fecha y Hora</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Ubicación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="text-sm font-bold text-slate-900">{log.userName}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-slate-600">{log.siteName}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded text-[8px] font-bold uppercase",
                      log.type === 'in' ? "bg-blue-50 text-blue-600" : "bg-rose-50 text-rose-600"
                    )}>
                      {log.type === 'in' ? 'Entrada' : 'Salida'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-xs font-mono text-slate-500">{format(new Date(log.timestamp), 'dd/MM/yyyy HH:mm:ss')}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-[10px] font-mono text-slate-400">{log.lat.toFixed(4)}, {log.lng.toFixed(4)}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

const AlertsHistory = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'alerts'), orderBy('timestamp', 'desc')), (snap) => {
      setAlerts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Alert)));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'alerts'));
    return unsub;
  }, []);

  const handleResolveAlert = async (id: string) => {
    try {
      await updateDoc(doc(db, 'alerts', id), { status: 'resolved' });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `alerts/${id}`);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Centro de Alertas</h2>
        <p className="text-slate-500 italic font-serif">Incidentes y violaciones de seguridad</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {alerts.map(alert => (
          <Card key={alert.id} className={cn(
            "border-l-4 transition-all p-4 md:p-6",
            alert.status === 'resolved' ? "border-l-slate-200 opacity-60" : "border-l-rose-500 shadow-lg shadow-rose-500/5"
          )}>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="flex gap-4">
                <div className={cn(
                  "p-3 rounded-xl shrink-0",
                  alert.status === 'resolved' ? "bg-slate-100 text-slate-400" : "bg-rose-100 text-rose-600"
                )}>
                  <AlertTriangle size={24} />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={cn(
                      "text-[10px] font-bold uppercase px-2 py-0.5 rounded",
                      alert.type === 'perimeter_violation' ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"
                    )}>
                      {alert.type.replace('_', ' ')}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {format(new Date(alert.timestamp), 'dd/MM HH:mm:ss')}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900 leading-tight">{alert.message}</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Sitio: <span className="font-bold text-slate-700">{alert.siteName}</span> • 
                    Guardia: <span className="font-bold text-slate-700">{alert.userName}</span>
                  </p>
                </div>
              </div>
              
              {alert.status !== 'resolved' && (
                <button 
                  onClick={() => handleResolveAlert(alert.id)}
                  className="w-full sm:w-auto px-4 py-2 bg-slate-900 text-white text-xs font-bold uppercase rounded-lg hover:bg-slate-800 transition-all"
                >
                  Resolver
                </button>
              )}
            </div>
          </Card>
        ))}
        {alerts.length === 0 && (
          <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-slate-200">
            <CheckCircle2 size={48} className="text-emerald-500 mx-auto mb-4 opacity-20" />
            <p className="text-slate-400 italic">No hay alertas activas en el sistema.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    testConnection();
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Fetch profile
        try {
          const profileDoc = await getDoc(doc(db, 'users', u.uid));
          if (profileDoc.exists()) {
            const data = profileDoc.data() as UserProfile;
            // Developer override for testing admin features
            if (u.email === 'angelotorresdiaz@gmail.com') {
              data.role = 'admin';
            }
            setProfile({ uid: profileDoc.id, ...data } as UserProfile);
          } else {
            // Create default profile if not exists (for first time admin login)
            const newProfile: UserProfile = {
              uid: u.uid,
              email: u.email || '',
              name: u.displayName || 'Admin',
              role: 'admin',
              createdAt: new Date().toISOString()
            };
            await setDoc(doc(db, 'users', u.uid), newProfile);
            setProfile(newProfile);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${u.uid}`);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400 font-mono text-xs uppercase tracking-widest animate-pulse">Iniciando Sistema...</p>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return <Login setUser={setUser} setProfile={setProfile} setLoading={setLoading} />;
  }

  return (
    <ErrorBoundary>
      <Router>
        <Layout user={user} profile={profile}>
          <Routes>
            {profile.role === 'admin' || profile.role === 'supervisor' ? (
              <>
                <Route path="/" element={<Dashboard />} />
                <Route path="/guards" element={<Guards />} />
                <Route path="/sites" element={<Sites />} />
                <Route path="/monitoring" element={<Monitoring />} />
                <Route path="/patrols" element={<PatrolsHistory />} />
                <Route path="/attendance" element={<AttendanceHistory />} />
                <Route path="/alerts" element={<AlertsHistory />} />
              </>
            ) : (
              <>
                <Route path="/" element={<GuardDashboard profile={profile} />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            )}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </Router>
    </ErrorBoundary>
  );
}
