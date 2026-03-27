import * as React from 'react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { Menu, Search, RefreshCw, User, Bell, LogOut, FileText, Plus, X, Filter, Clock, CheckCircle2, AlertCircle, Timer, Trash2, MessageSquare, Send, ChevronDown, ChevronUp, Palette, LogIn, Users, HelpCircle, Pencil, Camera, Image } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Toaster, toast } from 'sonner';

// --- UNIFIED CONFIGURATION & TYPES ---
import { initializeApp } from 'firebase/app';
import { 
  getAuth,
  onAuthStateChanged, 
  signOut,
  signInAnonymously
} from 'firebase/auth';
import { 
  getFirestore,
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy, 
  Timestamp,
  serverTimestamp,
  getDoc,
  setDoc,
  where,
  getDocs,
  limit,
  runTransaction,
  increment
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Types
type TicketStatus = 'Aberto' | 'Em Atendimento' | 'Aguardando Validação' | 'Concluído' | 'Cancelado';

interface Comment {
  id: string;
  text: string;
  author: string;
  createdAt: Date;
}

interface Ticket {
  id: string;
  client: string;
  contact: string;
  complaintDateTime: string;
  responsible: string;
  status: TicketStatus;
  sector: 'N2' | 'N3';
  subticket: 'supervisao' | 'backoffice' | 'N3' | '';
  priority: 'Normal' | 'Médio' | 'Urgente';
  description: string;
  solutionForecast: string;
  createdAt: Date;
  updatedAt: Date;
  comments: Comment[];
}

interface UserProfile {
  uid: string;
  username: string;
  password?: string;
  name: string;
  email?: string;
  photoUrl: string;
  notificationsEnabled: boolean;
  role: 'admin' | 'user' | 'supervisao';
  active?: boolean;
}

interface SupportMessage {
  id: string;
  chatId: string;
  text: string;
  senderId: string;
  senderName: string;
  senderRole: 'admin' | 'user';
  createdAt: Date;
}
// --- END UNIFIED SECTION ---

const ALERT_SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';

type Theme = 'white' | 'gray' | 'black' | 'cream';

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
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  toast.error(`Erro no banco de dados: ${errInfo.error}`);
  throw new Error(JSON.stringify(errInfo));
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('ErrorBoundary caught an error', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100 text-center">
            <AlertCircle className="w-16 h-16 text-rose-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Ops! Algo deu errado</h1>
            <p className="text-slate-500 text-sm mb-6">
              Ocorreu um erro inesperado na aplicação. Por favor, tente recarregar a página.
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="btn-primary w-full justify-center py-3"
            >
              Recarregar Página
            </button>
            {this.state.error && (
              <pre className="mt-6 p-4 bg-slate-100 rounded-lg text-left text-[10px] overflow-auto max-h-40 text-slate-600">
                {this.state.error.message}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
      <Toaster position="top-right" richColors />
    </ErrorBoundary>
  );
}

function MainApp() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth >= 768);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isTicketModalOpen, setIsTicketModalOpen] = useState(false);
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null);
  const [activePanel, setActivePanel] = useState<'all' | 'my' | 'waitingValidation' | 'n2' | 'n3' | 'completed' | 'cancelled' | 'backoffice' | 'supervision' | 'dashboard' | 'users'>('all');
  const [staleTickets, setStaleTickets] = useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(new Date());
  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({});
  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set());
  const [theme, setTheme] = useState<Theme>('white');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [fbUser, setFbUser] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [ticketToDeleteId, setTicketToDeleteId] = useState<string | null>(null);
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [isUserStatsModalOpen, setIsUserStatsModalOpen] = useState(false);
  const [isEditProfileModalOpen, setIsEditProfileModalOpen] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [editProfileName, setEditProfileName] = useState('');
  const [editProfilePhotoUrl, setEditProfilePhotoUrl] = useState('');
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [supportMessages, setSupportMessages] = useState<SupportMessage[]>([]);
  const [activeSupportChatId, setActiveSupportChatId] = useState<string | null>(null);
  const [supportChats, setSupportChats] = useState<Record<string, { lastMessage: string, userName: string, updatedAt: Date }>>({});
  const lastNotifiedStale = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (fbUser) => {
      setFbUser(fbUser);
      setIsAuthReady(true);
      
      // If user is from the context email, ensure they have admin role and correct UID in state
      if (fbUser && fbUser.email === 'iandroromulo2001@gmail.com') {
        setUser(prev => {
          if (prev && (prev.role !== 'admin' || prev.uid !== fbUser.uid)) {
            const updated = { ...prev, role: 'admin' as const, uid: fbUser.uid };
            localStorage.setItem('ticket_user', JSON.stringify(updated));
            return updated;
          }
          if (!prev) {
            const initial: UserProfile = {
              uid: fbUser.uid,
              username: 'admin_dev',
              password: '',
              name: fbUser.displayName || 'Admin Developer',
              role: 'admin',
              photoUrl: fbUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${fbUser.uid}`,
              notificationsEnabled: true,
              active: true
            };
            localStorage.setItem('ticket_user', JSON.stringify(initial));
            return initial;
          }
          return prev;
        });
      }
    });

    const bootstrapAdmin = async () => {
      try {
        // Ensure we are signed in anonymously for rules to work
        if (!auth.currentUser) {
          await signInAnonymously(auth);
        }

        // Check if ANY admin exists by username
        const q = query(collection(db, 'users'), where('username', '==', 'admin'), limit(1));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
          // No admin exists at all, create the initial one at admin_init
          const adminRef = doc(db, 'users', 'admin_init');
          await setDoc(adminRef, {
            uid: auth.currentUser?.uid || 'admin_init',
            username: 'admin',
            password: '12345678',
            name: 'Administrador Sistema',
            role: 'admin',
            photoUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=admin`,
            notificationsEnabled: true,
            active: true
          });
          console.log('Admin bootstrapped at admin_init');
        } else {
          const adminDoc = snapshot.docs[0];
          const adminData = adminDoc.data();
          
          // Ensure password is correct
          if (adminData.password !== '12345678') {
            await updateDoc(doc(db, 'users', adminDoc.id), {
              password: '12345678'
            });
          }

          // If we are logged in as this admin but the document is not at our UID 
          // and it's the admin_init document, update its UID field
          if (adminDoc.id === 'admin_init' && auth.currentUser && adminData.uid !== auth.currentUser.uid) {
            await updateDoc(doc(db, 'users', 'admin_init'), {
              uid: auth.currentUser.uid
            });
          }
        }
      } catch (err) {
        console.error('Erro no bootstrap:', err);
      }
    };
    bootstrapAdmin();

    // Custom Auth check
    const storedUser = localStorage.getItem('ticket_user');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
      } catch (e) {
        localStorage.removeItem('ticket_user');
      }
    }

    return () => unsubscribeAuth();
  }, []);

  // Dedicated profile listener to keep user state in sync with Firestore
  useEffect(() => {
    if (!fbUser) return;

    const unsubscribe = onSnapshot(doc(db, 'users', fbUser.uid), (snapshot) => {
      if (snapshot.exists()) {
        let userData = snapshot.data() as UserProfile;
        // Ensure admin role for developer email
        if (fbUser.email === 'iandroromulo2001@gmail.com') {
          userData = { ...userData, role: 'admin' };
        }
        // Only update if data actually changed to avoid infinite loops
        setUser(prev => {
          if (JSON.stringify(prev) !== JSON.stringify(userData)) {
            localStorage.setItem('ticket_user', JSON.stringify(userData));
            return userData;
          }
          return prev;
        });
      }
    }, (error) => {
      // This is expected if the document doesn't exist at the UID yet (e.g. before migration)
      // We don't use handleFirestoreError here to avoid spamming the console
      if (!error.message.includes('permission-denied')) {
        console.error("Error listening to user profile:", error);
      }
    });

    return () => unsubscribe();
  }, [fbUser]);

  useEffect(() => {
    if (!isAuthReady || !user || !fbUser) return;

    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      const usersData = snapshot.docs.map(doc => {
        const data = doc.data();
        // Prefer the uid field (which is the auth.uid) over doc.id (which might be admin_init)
        return { ...data, uid: data.uid || doc.id } as UserProfile;
      });
      setAllUsers(usersData);
      
      // If current user was updated, update local state
      // Use fbUser.uid to find the current user in the list for maximum reliability
      const currentUpdated = usersData.find(u => u.uid === fbUser.uid || u.uid === user.uid);
      if (currentUpdated && JSON.stringify(currentUpdated) !== JSON.stringify(user)) {
        setUser(currentUpdated);
        localStorage.setItem('ticket_user', JSON.stringify(currentUpdated));
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    return () => unsubscribe();
  }, [isAuthReady, user?.uid, user?.role, fbUser]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Erro ao deslogar:', err);
    }
    localStorage.removeItem('ticket_user');
    setUser(null);
    setActivePanel('all');
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    setIsSavingProfile(true);
    
    // Timeout to prevent infinite loading state
    let isStillSaving = true;
    const timeoutId = setTimeout(() => {
      if (isStillSaving) {
        setIsSavingProfile(false);
        toast.error('Tempo limite excedido ao salvar perfil. Tente novamente.');
      }
    }, 15000);

    try {
      // Find the document by username and password to be sure we have the right one
      // regardless of document ID migration state
      const q = query(
        collection(db, 'users'), 
        where('username', '==', user.username),
        where('password', '==', user.password),
        limit(1)
      );
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        throw new Error('Não foi possível encontrar seu perfil no banco de dados. Tente sair e entrar novamente.');
      }

      const userDoc = snapshot.docs[0];
      const userDocRef = doc(db, 'users', userDoc.id);
      
      const updateData: any = {
        name: editProfileName,
        photoUrl: editProfilePhotoUrl
      };

      // If we have a Firebase UID, ensure it's saved in the document
      if (auth.currentUser) {
        updateData.uid = auth.currentUser.uid;
      }

      await updateDoc(userDocRef, updateData);
      
      const updatedUser = { ...user, ...updateData };
      setUser(updatedUser);
      localStorage.setItem('ticket_user', JSON.stringify(updatedUser));
      
      setIsEditProfileModalOpen(false);
      toast.success('Perfil atualizado com sucesso!');
    } catch (err: any) {
      console.error('Erro ao atualizar perfil:', err);
      if (err.message.includes('permission') || err.message.includes('insufficient')) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
      } else {
        toast.error(err.message || 'Erro ao atualizar perfil');
      }
    } finally {
      isStillSaving = false;
      clearTimeout(timeoutId);
      setIsSavingProfile(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 500 * 1024) { // 500KB limit to be safe with Firestore 1MB limit
        toast.error('A imagem deve ter no máximo 500KB');
        return;
      }
      
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditProfilePhotoUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerateRandomAvatar = () => {
    setIsGeneratingAvatar(true);
    const seed = Math.random().toString(36).substring(7);
    const newUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;
    setEditProfilePhotoUrl(newUrl);
    // The onLoad on the <img> tag will handle setting isGeneratingAvatar to false
  };

  useEffect(() => {
    if (!isAuthReady || !user || !fbUser) return;

    const q = query(collection(db, 'tickets'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ticketsData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          id: doc.id,
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
          complaintDateTime: data.complaintDateTime,
          comments: (data.comments || []).map((c: any) => ({
            ...c,
            createdAt: c.createdAt?.toDate() || new Date()
          }))
        } as Ticket;
      });
      setTickets(ticketsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'tickets');
    });

    return () => unsubscribe();
  }, [isAuthReady, user, fbUser]);

  useEffect(() => {
    if (!isAuthReady || !user || !fbUser || user.uid !== fbUser.uid) return;

    // Standard user only listens to their own chat
    if (user.role !== 'admin') {
      const q = query(
        collection(db, 'support_messages'), 
        where('chatId', '==', user.uid),
        orderBy('createdAt', 'asc')
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const messages = snapshot.docs.map(doc => ({
          ...doc.data(),
          id: doc.id,
          createdAt: doc.data().createdAt?.toDate() || new Date()
        } as SupportMessage));
        setSupportMessages(messages);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'support_messages');
      });
      return () => unsubscribe();
    } else {
      // Admin listens to all messages to build the chat list
      const q = query(collection(db, 'support_messages'), orderBy('createdAt', 'desc'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const chats: Record<string, { lastMessage: string, userName: string, updatedAt: Date }> = {};
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          const chatId = data.chatId;
          if (!chats[chatId]) {
            chats[chatId] = {
              lastMessage: data.text,
              userName: data.senderRole === 'user' ? data.senderName : 'Suporte', // This is tricky, we need the user's name
              updatedAt: data.createdAt?.toDate() || new Date()
            };
          }
          // If the message is from a user, it's definitely their name
          if (data.senderRole === 'user') {
            chats[chatId].userName = data.senderName;
          }
        });
        setSupportChats(chats);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'support_messages_admin');
      });
      return () => unsubscribe();
    }
  }, [isAuthReady, user?.uid, user?.role, fbUser]);

  // Admin listening to active chat
  useEffect(() => {
    if (isAuthReady && fbUser && user && user.uid === fbUser.uid && ['admin', 'supervisao'].includes(user?.role as any) && activeSupportChatId) {
      const q = query(
        collection(db, 'support_messages'),
        where('chatId', '==', activeSupportChatId),
        orderBy('createdAt', 'asc')
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const messages = snapshot.docs.map(doc => ({
          ...doc.data(),
          id: doc.id,
          createdAt: doc.data().createdAt?.toDate() || new Date()
        } as SupportMessage));
        setSupportMessages(messages);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'support_messages_active');
      });
      return () => unsubscribe();
    }
  }, [isAuthReady, fbUser, user?.role, activeSupportChatId]);

  // Close sidebar on mobile when changing panels
  useEffect(() => {
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  }, [activePanel]);

  const parseForecastToMs = (forecast: string) => {
    if (!forecast) return 2 * 60 * 60 * 1000;
    const match = forecast.match(/(\d+)/);
    if (match) {
      const value = parseInt(match[1]);
      const lower = forecast.toLowerCase();
      if (lower.includes('hora')) return value * 60 * 60 * 1000;
      if (lower.includes('minuto')) return value * 60 * 1000;
      if (lower.includes('dia')) return value * 24 * 60 * 60 * 1000;
    }
    return 2 * 60 * 60 * 1000; // Default 2h
  };

  useEffect(() => {
    const checkStale = () => {
      const now = new Date().getTime();
      const newStale = new Set<string>();
      let shouldPlaySound = false;

      tickets.forEach((ticket) => {
        if (ticket.status !== 'Concluído' && ticket.status !== 'Cancelado') {
          const alertThreshold = parseForecastToMs(ticket.solutionForecast);
          const lastUpdate = new Date(ticket.updatedAt).getTime();
          const timeSinceOpen = now - new Date(ticket.complaintDateTime).getTime();
          const hasNoComments = !ticket.comments || ticket.comments.length === 0;

          if (now - lastUpdate > alertThreshold || (timeSinceOpen > alertThreshold && hasNoComments)) {
            newStale.add(ticket.id);
            if (!lastNotifiedStale.current.has(ticket.id)) {
              shouldPlaySound = true;
            }
          }
        }
      });

      lastNotifiedStale.current = newStale;
      setStaleTickets(prev => {
        if (prev.size === newStale.size && [...newStale].every(id => prev.has(id))) {
          return prev;
        }
        return newStale;
      });

      if (shouldPlaySound && user?.notificationsEnabled) {
        const audio = new Audio(ALERT_SOUND_URL);
        audio.play().catch(e => console.log('Audio play blocked:', e));
      }
    };

    const interval = setInterval(checkStale, 60000);
    checkStale();

    return () => clearInterval(interval);
  }, [tickets, user?.notificationsEnabled]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDuration = (ms: number) => {
    if (ms < 0) return '00:00:00';
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      const matchesSearch = 
        ticket.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ticket.client.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ticket.responsible.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ticket.subticket.toLowerCase().includes(searchQuery.toLowerCase());
      
      // Standard user cannot see supervision tickets at all
      if (!['admin', 'supervisao'].includes(user?.role as any) && ticket.subticket === 'supervisao') return false;

      if (activePanel === 'my') return matchesSearch && ticket.responsible === user?.name && ticket.status !== 'Concluído' && ticket.status !== 'Cancelado';
      if (activePanel === 'waitingValidation') return matchesSearch && ticket.status === 'Aguardando Validação';
      if (activePanel === 'n2') return matchesSearch && ticket.sector === 'N2' && ticket.status !== 'Concluído' && ticket.status !== 'Cancelado';
      if (activePanel === 'n3') return matchesSearch && ticket.sector === 'N3' && ticket.status !== 'Concluído' && ticket.status !== 'Cancelado';
      if (activePanel === 'completed') return matchesSearch && ticket.status === 'Concluído';
      if (activePanel === 'cancelled') return matchesSearch && ticket.status === 'Cancelado';
      if (activePanel === 'backoffice') return matchesSearch && ticket.subticket === 'backoffice' && ticket.status !== 'Concluído' && ticket.status !== 'Cancelado';
      if (activePanel === 'supervision') return matchesSearch && ticket.subticket === 'supervisao' && ticket.status !== 'Concluído' && ticket.status !== 'Cancelado';
      return matchesSearch && ticket.status !== 'Concluído' && ticket.status !== 'Cancelado';
    });
  }, [tickets, searchQuery, activePanel, user?.name, user?.role]);

  const handleCreateOrUpdateTicket = async (ticketData: Partial<Ticket>) => {
    try {
      if (editingTicket) {
        const ticketRef = doc(db, 'tickets', editingTicket.id);
        await updateDoc(ticketRef, {
          ...ticketData,
          updatedAt: serverTimestamp()
        });
        toast.success('Chamado atualizado com sucesso!');
      } else {
        await addDoc(collection(db, 'tickets'), {
          ...ticketData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          comments: []
        });
        toast.success('Chamado criado com sucesso!');
      }
      setIsTicketModalOpen(false);
      setEditingTicket(null);
    } catch (error) {
      handleFirestoreError(error, editingTicket ? OperationType.UPDATE : OperationType.CREATE, 'tickets');
    }
  };

  const handleDeleteTicket = (id: string) => {
    setTicketToDeleteId(id);
  };

  const confirmDeleteTicket = async () => {
    if (!ticketToDeleteId) return;
    try {
      await deleteDoc(doc(db, 'tickets', ticketToDeleteId));
      toast.success('Chamado excluído com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `tickets/${ticketToDeleteId}`);
    } finally {
      setTicketToDeleteId(null);
    }
  };

  const handleAddComment = async (ticketId: string) => {
    const text = commentTexts[ticketId];
    if (!text?.trim() || !user) return;

    const comment = {
      id: Math.random().toString(36).substr(2, 9),
      text,
      author: user.name,
      createdAt: new Date()
    };

    try {
      const ticketRef = doc(db, 'tickets', ticketId);
      const ticketDoc = await getDoc(ticketRef);
      if (ticketDoc.exists()) {
        const currentComments = ticketDoc.data().comments || [];
        await updateDoc(ticketRef, {
          comments: [...currentComments, comment],
          updatedAt: serverTimestamp()
        });
      }
      setCommentTexts(prev => ({ ...prev, [ticketId]: '' }));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tickets/${ticketId}`);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedTickets(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getStatusColor = (status: TicketStatus) => {
    switch (status) {
      case 'Aberto': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'Em Atendimento': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'Aguardando Validação': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'Concluído': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'Cancelado': return 'bg-rose-100 text-rose-700 border-rose-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getPriorityColor = (priority: Ticket['priority']) => {
    switch (priority) {
      case 'Normal': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'Médio': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'Urgente': return 'bg-rose-100 text-rose-700 border-rose-200';
      default: return 'bg-blue-100 text-blue-700 border-blue-200';
    }
  };

  const getThemeStyles = () => {
    switch (theme) {
      case 'gray': 
        return {
          bg: 'bg-gray-200',
          text: 'text-slate-900',
          panel: 'bg-gray-100 border-gray-300',
          card: 'bg-gray-50 border-gray-300',
          muted: 'text-slate-500',
          input: 'bg-white border-gray-300',
          sidebarItem: 'text-slate-600 hover:bg-slate-200',
          header: 'bg-gray-100/80 border-gray-300',
          badge: 'bg-gray-300 text-slate-600',
          secondaryBtn: 'bg-gray-300 hover:bg-gray-400 text-slate-700 border-gray-400'
        };
      case 'black': 
        return {
          bg: 'bg-slate-950',
          text: 'text-slate-100',
          panel: 'bg-slate-900 border-slate-800',
          card: 'bg-slate-900/80 border-slate-700',
          muted: 'text-slate-400',
          input: 'bg-slate-800 border-slate-700 text-white',
          sidebarItem: 'text-slate-400 hover:bg-slate-800',
          header: 'bg-slate-900/80 border-slate-800',
          badge: 'bg-slate-800 text-slate-400',
          secondaryBtn: 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
        };
      case 'cream': 
        return {
          bg: 'bg-[#f5f5dc]',
          text: 'text-slate-900',
          panel: 'bg-[#fafaf0] border-[#e5e5d0]',
          card: 'bg-[#ffffff]/90 border-[#e5e5d0]',
          muted: 'text-slate-600',
          input: 'bg-white border-[#e5e5d0]',
          sidebarItem: 'text-slate-600 hover:bg-[#ebebd0]',
          header: 'bg-[#fafaf0]/80 border-[#e5e5d0]',
          badge: 'bg-[#ebebd0] text-slate-600',
          secondaryBtn: 'bg-[#ebebd0] hover:bg-[#e0e0c0] text-slate-700 border-[#d0d0b0]'
        };
      default: 
        return {
          bg: 'bg-slate-50',
          text: 'text-slate-900',
          panel: 'bg-white border-slate-200',
          card: 'bg-white border-slate-200',
          muted: 'text-slate-500',
          input: 'bg-white border-slate-200',
          sidebarItem: 'text-slate-600 hover:bg-slate-50',
          header: 'bg-white/80 border-slate-200',
          badge: 'bg-slate-100 text-slate-500',
          secondaryBtn: 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
        };
    }
  };

  const styles = getThemeStyles();

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen setAuthError={setAuthError} authError={authError} />;
  }

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-500 ${styles.bg} ${styles.text}`}>
      {/* Top Bar */}
      <header className={`h-16 sticky top-0 z-40 px-4 flex items-center justify-between border-b ${styles.header} backdrop-blur-md shadow-sm`}>
        <div className="flex items-center gap-2 md:gap-4">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className={`p-2 rounded-lg transition-colors ${theme === 'black' ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}
          >
            <Menu className={`w-6 h-6 ${theme === 'black' ? 'text-slate-400' : 'text-slate-600'}`} />
          </button>
          <div className="flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-600" />
            <span className={`font-bold text-lg md:text-xl tracking-tight ${styles.text}`}>TicketMaster</span>
          </div>
        </div>

        <div className="hidden sm:block flex-1 max-w-2xl mx-4 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input 
            type="text" 
            placeholder="Pesquisar chamados..."
            className={`input-field pl-10 ${styles.input}`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-1 md:gap-2">
          <div className={`flex items-center gap-1 px-2 py-1 rounded-full ${theme === 'black' ? 'bg-slate-800/50' : 'bg-slate-100/50'} border ${theme === 'black' ? 'border-slate-700' : 'border-slate-200'}`}>
            {(['white', 'gray', 'black', 'cream'] as Theme[]).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`w-4 h-4 md:w-5 md:h-5 rounded-full border-2 transition-all hover:scale-110 ${
                  theme === t ? 'border-blue-500 scale-110' : 'border-transparent'
                } ${
                  t === 'white' ? 'bg-white shadow-sm' : 
                  t === 'gray' ? 'bg-gray-400' : 
                  t === 'black' ? 'bg-slate-900' : 
                  'bg-[#f5f5dc]'
                }`}
                title={t === 'white' ? 'Padrão' : t.charAt(0).toUpperCase() + t.slice(1)}
              />
            ))}
          </div>

          <button 
            onClick={() => setIsUserStatsModalOpen(true)}
            className={`p-2 rounded-lg transition-colors ${theme === 'black' ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-600'}`}
            title="Estatísticas de Usuários"
          >
            <Users className="w-5 h-5" />
          </button>

          <button 
            onClick={() => window.location.reload()}
            className={`p-2 rounded-lg transition-colors ${theme === 'black' ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-600'}`}
            title="Atualizar"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          
          <div className="relative">
            <button 
              onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
              className={`flex items-center gap-2 p-1 pr-2 rounded-full transition-colors ${theme === 'black' ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}
            >
              <img src={user.photoUrl} alt="Avatar" className="w-8 h-8 rounded-full border border-slate-200" />
              <span className={`hidden sm:block text-sm font-medium ${theme === 'black' ? 'text-slate-300' : 'text-slate-700'}`}>{user.name}</span>
            </button>

            <AnimatePresence>
              {isProfileMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsProfileMenuOpen(false)} />
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className={`absolute right-0 mt-2 w-64 rounded-xl shadow-xl z-50 overflow-hidden border ${styles.panel}`}
                  >
                    <div className={`p-4 border-b ${theme === 'black' ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50/50 border-slate-100'}`}>
                      <p className={`font-semibold ${styles.text}`}>{user.name}</p>
                      <p className={`text-xs truncate ${styles.muted}`}>{user.email}</p>
                    </div>
                    <div className="p-2">
                      <button 
                        onClick={() => {
                          setEditProfileName(user.name);
                          setEditProfilePhotoUrl(user.photoUrl);
                          setIsEditProfileModalOpen(true);
                          setIsProfileMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors ${theme === 'black' ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-100'}`}
                      >
                        <User className="w-4 h-4" /> Editar Perfil
                      </button>
                      <button 
                        onClick={async () => {
                          const userDocRef = doc(db, 'users', user.uid);
                          await updateDoc(userDocRef, { notificationsEnabled: !user.notificationsEnabled });
                          setUser(prev => prev ? { ...prev, notificationsEnabled: !prev.notificationsEnabled } : null);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors ${theme === 'black' ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-100'}`}
                      >
                        <div className="flex items-center gap-3">
                          <Bell className="w-4 h-4" /> Notificações
                        </div>
                        <div className={`w-8 h-4 rounded-full transition-colors relative ${user.notificationsEnabled ? 'bg-blue-600' : 'bg-slate-300'}`}>
                          <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${user.notificationsEnabled ? 'left-4.5' : 'left-0.5'}`} />
                        </div>
                      </button>
                      <div className={`h-px my-1 ${theme === 'black' ? 'bg-slate-800' : 'bg-slate-100'}`} />
                      <button 
                        onClick={handleLogout}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-rose-600 rounded-lg transition-colors ${theme === 'black' ? 'hover:bg-rose-900/30' : 'hover:bg-rose-50'}`}
                      >
                        <LogOut className="w-4 h-4" /> Sair
                      </button>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar Overlay for Mobile */}
        <AnimatePresence>
          {isSidebarOpen && window.innerWidth < 768 && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-30 md:hidden"
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <AnimatePresence initial={false}>
          {isSidebarOpen && (
            <motion.aside 
              initial={{ x: -260, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -260, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className={`fixed md:relative inset-y-0 left-0 w-[260px] z-40 md:z-0 border-r flex flex-col overflow-hidden ${styles.panel} shadow-2xl md:shadow-none`}
            >
              <div className="p-4 flex flex-col gap-2">
                <button 
                  onClick={() => { setEditingTicket(null); setIsTicketModalOpen(true); }}
                  className="btn-primary w-full justify-center py-3 shadow-lg shadow-blue-500/20"
                >
                  <Plus className="w-5 h-5" /> Novo Chamado
                </button>
              </div>
              <nav className="flex-1 p-2 flex flex-col gap-1">
                <p className={`px-3 py-2 text-xs font-bold uppercase tracking-wider ${styles.muted}`}>Painéis</p>
                {['admin', 'supervisao'].includes(user?.role as any) && (
                  <>
                    <SidebarItem 
                      icon={<Timer className="w-5 h-5 text-blue-500" />} 
                      label="Dashboard Geral" 
                      active={activePanel === 'dashboard'} 
                      onClick={() => setActivePanel('dashboard')}
                      themeStyles={styles}
                    />
                    <SidebarItem 
                      icon={<Users className="w-5 h-5 text-purple-500" />} 
                      label="Gerenciar Usuários" 
                      active={activePanel === 'users'} 
                      onClick={() => setActivePanel('users')}
                      themeStyles={styles}
                    />
                    <div className={`h-px my-2 ${theme === 'black' ? 'bg-slate-800' : 'bg-slate-100'}`} />
                  </>
                )}
                <SidebarItem 
                  icon={<FileText className="w-5 h-5" />} 
                  label="Todos os Chamados" 
                  active={activePanel === 'all'} 
                  onClick={() => setActivePanel('all')}
                  count={tickets.filter(t => 
                    t.status !== 'Concluído' && 
                    t.status !== 'Cancelado' && 
                    (['admin', 'supervisao'].includes(user?.role as any) || t.subticket !== 'supervisao')
                  ).length}
                  themeStyles={styles}
                />
                <SidebarItem 
                  icon={<User className="w-5 h-5" />} 
                  label="Meus Chamados" 
                  active={activePanel === 'my'} 
                  onClick={() => setActivePanel('my')}
                  count={tickets.filter(t => t.responsible === user.name && t.status !== 'Concluído' && t.status !== 'Cancelado').length}
                  themeStyles={styles}
                />
                <SidebarItem 
                  icon={<AlertCircle className="w-5 h-5" />} 
                  label="Aguardando Validação" 
                  active={activePanel === 'waitingValidation'} 
                  onClick={() => setActivePanel('waitingValidation')}
                  count={tickets.filter(t => t.status === 'Aguardando Validação').length}
                  themeStyles={styles}
                />
                <div className={`h-px my-2 ${theme === 'black' ? 'bg-slate-800' : 'bg-slate-100'}`} />
                <SidebarItem 
                  icon={<FileText className="w-5 h-5 text-blue-500" />} 
                  label="Chamados N2" 
                  active={activePanel === 'n2'} 
                  onClick={() => setActivePanel('n2')}
                  count={tickets.filter(t => t.sector === 'N2' && t.status !== 'Concluído' && t.status !== 'Cancelado').length}
                  themeStyles={styles}
                />
                <SidebarItem 
                  icon={<FileText className="w-5 h-5 text-purple-500" />} 
                  label="Chamados N3" 
                  active={activePanel === 'n3'} 
                  onClick={() => setActivePanel('n3')}
                  count={tickets.filter(t => t.sector === 'N3' && t.status !== 'Concluído' && t.status !== 'Cancelado').length}
                  themeStyles={styles}
                />
                <SidebarItem 
                  icon={<CheckCircle2 className="w-5 h-5 text-emerald-500" />} 
                  label="Concluídos" 
                  active={activePanel === 'completed'} 
                  onClick={() => setActivePanel('completed')}
                  count={tickets.filter(t => t.status === 'Concluído').length}
                  themeStyles={styles}
                />
                <SidebarItem 
                  icon={<X className="w-5 h-5 text-rose-500" />} 
                  label="Cancelados" 
                  active={activePanel === 'cancelled'} 
                  onClick={() => setActivePanel('cancelled')}
                  count={tickets.filter(t => t.status === 'Cancelado').length}
                  themeStyles={styles}
                />
                <SidebarItem 
                  icon={<User className="w-5 h-5 text-amber-500" />} 
                  label="Backoffice" 
                  active={activePanel === 'backoffice'} 
                  onClick={() => setActivePanel('backoffice')}
                  count={tickets.filter(t => t.subticket === 'backoffice' && t.status !== 'Concluído' && t.status !== 'Cancelado').length}
                  themeStyles={styles}
                />
                <SidebarItem 
                  icon={<User className="w-5 h-5 text-indigo-500" />} 
                  label="Supervisão" 
                  active={activePanel === 'supervision'} 
                  onClick={() => setActivePanel('supervision')}
                  count={['admin', 'supervisao'].includes(user?.role as any) ? tickets.filter(t => t.subticket === 'supervisao' && t.status !== 'Concluído' && t.status !== 'Cancelado').length : 0}
                  themeStyles={styles}
                />
              </nav>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 w-full">
          <div className="max-w-7xl mx-auto">
            {/* Mobile Search - Only visible on small screens */}
            <div className="sm:hidden mb-6 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input 
                type="text" 
                placeholder="Pesquisar chamados..."
                className={`input-field pl-10 w-full ${styles.input}`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
              <div>
                <h1 className={`text-xl md:text-2xl font-bold ${styles.text}`}>
                  {activePanel === 'dashboard' ? 'Dashboard Administrativo' :
                   activePanel === 'users' ? 'Gerenciamento de Usuários' :
                   activePanel === 'all' ? 'Todos os Chamados' : 
                   activePanel === 'my' ? 'Meus Chamados' : 
                   activePanel === 'waitingValidation' ? 'Aguardando Validação' :
                   activePanel === 'n2' ? 'Chamados N2' :
                   activePanel === 'n3' ? 'Chamados N3' :
                   activePanel === 'completed' ? 'Chamados Concluídos' :
                   activePanel === 'cancelled' ? 'Chamados Cancelados' :
                   activePanel === 'backoffice' ? 'Chamados Backoffice' :
                   'Chamados Supervisão'}
                </h1>
                <p className={`${styles.muted} text-sm`}>
                  {activePanel === 'dashboard' ? 'Visão geral de desempenho e métricas do sistema.' :
                   activePanel === 'users' ? 'Crie e gerencie contas de usuários e administradores.' :
                   'Gerencie e acompanhe o status dos atendimentos em tempo real.'}
                </p>
              </div>
            </div>

            {activePanel === 'dashboard' && ['admin', 'supervisao'].includes(user?.role as any) ? (
              <AdminDashboard tickets={tickets} allUsers={allUsers} styles={styles} theme={theme} currentTime={currentTime} />
            ) : activePanel === 'users' && ['admin', 'supervisao'].includes(user?.role as any) ? (
              <UserManagement allUsers={allUsers} styles={styles} theme={theme} />
            ) : activePanel === 'supervision' && !['admin', 'supervisao'].includes(user?.role as any) ? (
              <div className={`flex flex-col items-center justify-center py-20 rounded-2xl border-2 border-dashed transition-colors duration-500 ${styles.card} ${styles.muted}`}>
                <AlertCircle className="w-16 h-16 mb-4 text-rose-500" />
                <p className={`text-lg font-bold ${styles.text}`}>Acesso Negado</p>
                <p className="text-sm">Você não tem permissão para acessar esse painel</p>
              </div>
            ) : filteredTickets.length === 0 ? (
              <div className={`flex flex-col items-center justify-center py-20 rounded-2xl border-2 border-dashed transition-colors duration-500 ${styles.card} ${styles.muted}`}>
                <FileText className="w-16 h-16 mb-4 opacity-20" />
                <p className={`text-lg font-medium ${styles.text}`}>Nenhum chamado encontrado</p>
                <p className="text-sm">Tente ajustar sua pesquisa ou filtros.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <AnimatePresence mode="popLayout">
                  {filteredTickets.map((ticket) => (
                    <motion.div 
                      key={ticket.id}
                      layout
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className={`relative rounded-2xl p-6 hover:shadow-md transition-all group border ${
                        staleTickets.has(ticket.id) ? 'animate-pulse-red border-rose-300' : ''
                      } ${styles.card}`}
                    >
                      {staleTickets.has(ticket.id) && (
                        <div className="absolute -top-3 -right-3 bg-rose-600 text-white text-[10px] font-black px-3 py-1 rounded-full shadow-lg animate-bounce z-10 border-2 border-white uppercase tracking-tighter">
                          ALERTA: SEM ATUALIZAÇÃO
                        </div>
                      )}
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-xl ${getPriorityColor(ticket.priority || 'Normal')}`}>
                            {ticket.status === 'Concluído' ? <CheckCircle2 className="w-6 h-6" /> : 
                             ticket.status === 'Cancelado' ? <X className="w-6 h-6" /> : 
                             <AlertCircle className="w-6 h-6" />}
                          </div>
                          <div>
                            <h3 className={`font-bold text-lg ${styles.text}`}>{ticket.client}</h3>
                            <div className="flex items-center gap-2">
                              <p className={`text-sm ${styles.muted}`}>{ticket.contact}</p>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${theme === 'black' ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-600'}`}>{ticket.sector}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold border ${getStatusColor(ticket.status)}`}>
                            {ticket.status}
                          </span>
                          <button 
                            onClick={() => { setEditingTicket(ticket); setIsTicketModalOpen(true); }}
                            className={`p-2 rounded-lg transition-colors ${theme === 'black' ? 'hover:bg-slate-800 text-slate-500' : 'hover:bg-slate-100 text-slate-400'} hover:text-blue-600`}
                          >
                            <Plus className="w-4 h-4 rotate-45" />
                          </button>
                          {['admin', 'supervisao'].includes(user?.role as any) && (
                            <button 
                              onClick={() => handleDeleteTicket(ticket.id)}
                              className={`p-2 rounded-lg transition-colors ${theme === 'black' ? 'hover:bg-rose-900/30 text-slate-500' : 'hover:bg-rose-50 text-slate-400'} hover:text-rose-600`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-6">
                        <div className="space-y-1 col-span-2">
                          <div className="flex items-center justify-between">
                            <p className={`text-[10px] font-bold uppercase tracking-wider ${styles.muted}`}>Descrição</p>
                            <button 
                              onClick={() => toggleExpand(ticket.id)}
                              className="text-[10px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                            >
                              {expandedTickets.has(ticket.id) ? (
                                <>Recolher <ChevronUp className="w-3 h-3" /></>
                              ) : (
                                <>Expandir <ChevronDown className="w-3 h-3" /></>
                              )}
                            </button>
                          </div>
                          <p className={`text-sm italic transition-all duration-300 ${styles.muted} ${
                            expandedTickets.has(ticket.id) ? '' : 'line-clamp-2'
                          }`}>
                            "{ticket.description}"
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className={`text-[10px] font-bold uppercase tracking-wider ${styles.muted}`}>Subticket</p>
                          <p className={`text-sm font-medium ${styles.text}`}>{ticket.subticket || 'Nenhum'}</p>
                        </div>
                        <div className="space-y-1">
                          <p className={`text-[10px] font-bold uppercase tracking-wider ${styles.muted}`}>Responsável</p>
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center text-[10px] font-bold text-blue-600">
                              {ticket.responsible.charAt(0)}
                            </div>
                            <p className={`text-sm font-medium ${styles.text}`}>{ticket.responsible}</p>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className={`text-[10px] font-bold uppercase tracking-wider ${styles.muted}`}>Reclamação</p>
                          <div className={`flex items-center gap-1.5 text-sm ${styles.muted}`}>
                            <Clock className="w-3.5 h-3.5" />
                            {format(new Date(ticket.complaintDateTime), "dd/MM/yy 'às' HH:mm", { locale: ptBR })}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className={`text-[10px] font-bold uppercase tracking-wider ${styles.muted}`}>Previsão</p>
                          <div className="flex items-center gap-1.5 text-sm font-semibold text-blue-600">
                            <Timer className="w-3.5 h-3.5" />
                            {ticket.solutionForecast}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <p className={`text-[10px] font-bold uppercase tracking-wider ${styles.muted}`}>Tempo Aberto</p>
                          <div className={`flex items-center gap-1.5 text-sm font-mono font-medium ${styles.muted}`}>
                            <Clock className="w-3.5 h-3.5" />
                            {formatDuration(currentTime.getTime() - new Date(ticket.complaintDateTime).getTime())}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className={`text-[10px] font-bold uppercase tracking-wider ${styles.muted}`}>Tempo p/ Alerta</p>
                          <div className={`flex items-center gap-1.5 text-sm font-mono font-bold ${staleTickets.has(ticket.id) ? 'text-rose-600' : 'text-amber-600'}`}>
                            <AlertCircle className="w-3.5 h-3.5" />
                            {ticket.status === 'Concluído' || ticket.status === 'Cancelado' 
                              ? '--:--:--' 
                              : formatDuration(parseForecastToMs(ticket.solutionForecast) - (currentTime.getTime() - new Date(ticket.updatedAt).getTime()))}
                          </div>
                        </div>
                      </div>

                      {/* Comments Section */}
                      <AnimatePresence>
                        {expandedTickets.has(ticket.id) && (
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className={`mt-6 pt-6 border-t overflow-hidden ${theme === 'black' ? 'border-slate-800' : 'border-slate-100'}`}
                          >
                            <div className="flex items-center gap-2 mb-4">
                              <MessageSquare className={`w-4 h-4 ${styles.muted}`} />
                              <h4 className={`text-xs font-bold uppercase tracking-wider ${styles.muted}`}>Comentários ({ticket.comments?.length || 0})</h4>
                            </div>
                            
                            <div className={`space-y-3 overflow-y-auto mb-4 scrollbar-hide transition-all duration-300 ${
                              expandedTickets.has(ticket.id) ? 'max-h-64' : 'max-h-32'
                            }`}>
                              {ticket.comments?.map((comment) => (
                                <div key={comment.id} className={`${theme === 'black' ? 'bg-slate-800' : 'bg-slate-50'} rounded-lg p-3 text-xs`}>
                                  <div className="flex justify-between items-center mb-1">
                                    <span className={`font-bold ${styles.text}`}>{comment.author}</span>
                                    <span className={styles.muted}>{format(new Date(comment.createdAt), "HH:mm", { locale: ptBR })}</span>
                                  </div>
                                  <p className={`${styles.muted} leading-relaxed`}>{comment.text}</p>
                                </div>
                              ))}
                            </div>

                            <div className="flex gap-2">
                              <input
                                type="text"
                                placeholder="Adicionar comentário..."
                                className={`flex-1 border-none rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500/20 outline-none ${styles.input}`}
                                value={commentTexts[ticket.id] || ''}
                                onChange={(e) => setCommentTexts(prev => ({ ...prev, [ticket.id]: e.target.value }))}
                                onKeyPress={(e) => e.key === 'Enter' && handleAddComment(ticket.id)}
                              />
                              <button 
                                onClick={() => handleAddComment(ticket.id)}
                                className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                              >
                                <Send className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div className={`flex items-center justify-between pt-4 border-t mt-4 ${theme === 'black' ? 'border-slate-800' : 'border-slate-100'}`}>
                        <span className={`text-[10px] font-mono ${styles.muted}`}>ID: #{ticket.id}</span>
                        <button 
                          onClick={() => { setEditingTicket(ticket); setIsTicketModalOpen(true); }}
                          className="text-sm font-bold text-blue-600 hover:text-blue-700 transition-colors"
                        >
                          Ver detalhes
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Modal de Confirmação de Exclusão de Chamado */}
      <AnimatePresence>
        {ticketToDeleteId && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={`max-w-sm w-full p-6 rounded-2xl border shadow-2xl text-center ${styles.card}`}
            >
              <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h3 className={`text-xl font-bold mb-2 ${styles.text}`}>Tem certeza que deseja excluir?</h3>
              <p className={`text-sm mb-6 ${styles.muted}`}>
                Esta ação não pode ser desfeita. O chamado será removido permanentemente do sistema.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setTicketToDeleteId(null)}
                  className="flex-1 px-4 py-2 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={confirmDeleteTicket}
                  className={`flex-1 px-4 py-2 rounded-xl font-bold transition-colors ${theme === 'black' ? 'bg-slate-800 text-rose-500 hover:bg-slate-700' : 'bg-rose-50 text-rose-600 hover:bg-rose-100'}`}
                >
                  Sim
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isTicketModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setIsTicketModalOpen(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={`relative w-full max-w-2xl max-h-[90vh] md:max-h-none overflow-y-auto rounded-2xl shadow-2xl border ${styles.panel}`}
            >
              <div className={`p-6 border-b flex items-center justify-between ${theme === 'black' ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50/50 border-slate-100'}`}>
                <h2 className={`text-xl font-bold ${styles.text}`}>
                  {editingTicket ? 'Editar Chamado' : 'Novo Chamado'}
                </h2>
                <button 
                  onClick={() => setIsTicketModalOpen(false)}
                  className={`p-2 rounded-lg transition-colors ${theme === 'black' ? 'hover:bg-slate-700' : 'hover:bg-slate-200'}`}
                >
                  <X className={`w-5 h-5 ${styles.muted}`} />
                </button>
              </div>
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                    handleCreateOrUpdateTicket({
                      client: formData.get('client') as string,
                      contact: formData.get('contact') as string,
                      complaintDateTime: formData.get('complaintDateTime') as string,
                      responsible: formData.get('responsible') as string,
                      status: formData.get('status') as TicketStatus,
                      sector: formData.get('sector') as 'N2' | 'N3',
                      subticket: formData.get('subticket') as any,
                      priority: formData.get('priority') as any,
                      description: formData.get('description') as string,
                      solutionForecast: formData.get('solutionForecast') as string,
                    });
                }}
                className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4"
              >
                <div className="space-y-1">
                  <label className={`text-xs font-bold uppercase ${styles.muted}`}>Cliente</label>
                  <input name="client" required defaultValue={editingTicket?.client} className={`input-field ${styles.input}`} placeholder="Nome do cliente" />
                </div>
                <div className="space-y-1">
                  <label className={`text-xs font-bold uppercase ${styles.muted}`}>Contato</label>
                  <input name="contact" required defaultValue={editingTicket?.contact} className={`input-field ${styles.input}`} placeholder="Telefone ou e-mail" />
                </div>
                <div className="space-y-1">
                  <label className={`text-xs font-bold uppercase ${styles.muted}`}>Data/Hora Reclamação</label>
                  <input name="complaintDateTime" type="datetime-local" required defaultValue={editingTicket?.complaintDateTime || format(new Date(), "yyyy-MM-dd'T'HH:mm")} className={`input-field ${styles.input}`} />
                </div>
                <div className="space-y-1">
                  <label className={`text-xs font-bold uppercase ${styles.muted}`}>Responsável</label>
                  <input name="responsible" required defaultValue={editingTicket?.responsible || user.name} className={`input-field ${styles.input}`} placeholder="Nome do técnico" />
                </div>
                <div className="space-y-1">
                  <label className={`text-xs font-bold uppercase ${styles.muted}`}>Status</label>
                  <select name="status" defaultValue={editingTicket?.status || 'Aberto'} className={`input-field ${styles.input}`}>
                    <option value="Aberto">Aberto</option>
                    <option value="Em Atendimento">Em Atendimento</option>
                    <option value="Aguardando Validação">Aguardando Validação</option>
                    <option value="Concluído">Concluído</option>
                    <option value="Cancelado">Cancelado</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={`text-xs font-bold uppercase ${styles.muted}`}>Setor</label>
                  <select name="sector" defaultValue={editingTicket?.sector || 'N2'} className={`input-field ${styles.input}`}>
                    <option value="N2">N2</option>
                    <option value="N3">N3</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={`text-xs font-bold uppercase ${styles.muted}`}>Subticket (Opcional)</label>
                  <select name="subticket" defaultValue={editingTicket?.subticket || ''} className={`input-field ${styles.input}`}>
                    <option value="">Nenhum</option>
                    <option value="supervisao">Supervisão</option>
                    <option value="backoffice">Backoffice</option>
                    <option value="N3">N3</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={`text-xs font-bold uppercase ${styles.muted}`}>Prioridade</label>
                  <select name="priority" defaultValue={editingTicket?.priority || 'Normal'} className={`input-field ${styles.input}`}>
                    <option value="Normal">Normal</option>
                    <option value="Médio">Médio</option>
                    <option value="Urgente">Urgente</option>
                  </select>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className={`text-xs font-bold uppercase ${styles.muted}`}>Descrição do Problema</label>
                  <textarea 
                    name="description" 
                    required 
                    defaultValue={editingTicket?.description} 
                    className={`input-field min-h-[100px] resize-none ${styles.input}`} 
                    placeholder="Descreva detalhadamente o problema relatado pelo cliente..."
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className={`text-xs font-bold uppercase ${styles.muted}`}>Previsão de Solução</label>
                  <select 
                    name="solutionForecast" 
                    required 
                    defaultValue={editingTicket?.solutionForecast || '2 horas'} 
                    className={`input-field ${styles.input}`}
                  >
                    <option value="30 minutos">30 minutos</option>
                    <option value="2 horas">2 horas</option>
                    <option value="6 horas">6 horas</option>
                    <option value="24 horas">24 horas</option>
                    <option value="48 horas">48 horas</option>
                  </select>
                </div>
                <div className="md:col-span-2 pt-4 flex gap-3">
                  <button type="submit" className="btn-primary flex-1 justify-center">
                    {editingTicket ? 'Salvar Alterações' : 'Criar Chamado'}
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setIsTicketModalOpen(false)}
                    className={`btn-secondary flex-1 justify-center border ${styles.secondaryBtn}`}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal de Estatísticas de Usuários */}
      <UserStatsModal 
        isOpen={isUserStatsModalOpen}
        onClose={() => setIsUserStatsModalOpen(false)}
        allUsers={allUsers}
        tickets={tickets}
        styles={styles}
        theme={theme}
      />

      {/* Modal de Edição de Perfil */}
      <AnimatePresence>
        {isEditProfileModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setIsEditProfileModalOpen(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={`relative w-full max-w-md rounded-2xl shadow-2xl border ${styles.panel}`}
            >
              <div className={`p-6 border-b flex items-center justify-between ${theme === 'black' ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50/50 border-slate-100'}`}>
                <h2 className={`text-xl font-bold ${styles.text}`}>Editar Perfil</h2>
                <button 
                  onClick={() => setIsEditProfileModalOpen(false)}
                  className={`p-2 rounded-lg transition-colors ${theme === 'black' ? 'hover:bg-slate-700' : 'hover:bg-slate-200'}`}
                >
                  <X className={`w-5 h-5 ${styles.muted}`} />
                </button>
              </div>
              
              <form onSubmit={handleUpdateProfile} className="p-6 space-y-6">
                <div className="flex flex-col items-center gap-4">
                  <input 
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept="image/*"
                    className="hidden"
                  />
                  <div 
                    className="relative group cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <div className="w-24 h-24 rounded-full border-4 border-blue-500/20 overflow-hidden relative">
                      {isGeneratingAvatar && (
                        <div className="absolute inset-0 bg-black/20 flex items-center justify-center z-10">
                          <RefreshCw className="w-6 h-6 text-white animate-spin" />
                        </div>
                      )}
                      <img 
                        src={editProfilePhotoUrl} 
                        alt="Avatar Preview" 
                        onLoad={() => setIsGeneratingAvatar(false)}
                        onError={() => {
                          setIsGeneratingAvatar(false);
                          toast.error('Erro ao carregar imagem');
                        }}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Camera className="w-6 h-6 text-white" />
                    </div>
                  </div>
                  <button 
                    type="button"
                    onClick={handleGenerateRandomAvatar}
                    disabled={isGeneratingAvatar}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-2 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isGeneratingAvatar ? 'animate-spin' : ''}`} /> 
                    {isGeneratingAvatar ? 'Gerando...' : 'Gerar novo avatar'}
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className={`block text-xs font-bold uppercase tracking-wider mb-2 ${styles.muted}`}>Nome Completo</label>
                    <input 
                      type="text"
                      required
                      value={editProfileName}
                      onChange={(e) => setEditProfileName(e.target.value)}
                      className={`w-full p-3 rounded-xl border focus:ring-2 focus:ring-blue-500 outline-none transition-all ${styles.input}`}
                      placeholder="Seu nome"
                    />
                  </div>
                  <div>
                    <label className={`block text-xs font-bold uppercase tracking-wider mb-2 ${styles.muted}`}>URL da Foto (Opcional)</label>
                    <div className="relative">
                      <input 
                        type="url"
                        value={editProfilePhotoUrl}
                        onChange={(e) => setEditProfilePhotoUrl(e.target.value)}
                        className={`w-full p-3 pl-10 rounded-xl border focus:ring-2 focus:ring-blue-500 outline-none transition-all ${styles.input}`}
                        placeholder="https://exemplo.com/foto.jpg"
                      />
                      <Image className={`absolute left-3 top-3.5 w-4 h-4 ${styles.muted}`} />
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsEditProfileModalOpen(false)}
                    className={`flex-1 px-4 py-2 rounded-xl font-bold transition-all ${theme === 'black' ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    disabled={isGeneratingAvatar || isSavingProfile}
                    className="flex-1 btn-primary justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSavingProfile ? (
                      <div className="flex items-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin" /> Salvando...
                      </div>
                    ) : 'Salvar Alterações'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Botão de Suporte Flutuante */}
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setIsSupportOpen(!isSupportOpen)}
        className="fixed bottom-6 left-6 z-[100] w-10 h-10 bg-blue-600 text-white rounded-full shadow-2xl flex items-center justify-center hover:bg-blue-700 transition-colors border-2 border-white dark:border-slate-800"
        title="Suporte"
      >
        <HelpCircle className="w-5 h-5" />
      </motion.button>

      {/* Janela de Chat de Suporte */}
      <AnimatePresence>
        {isSupportOpen && (
          <SupportChat 
            user={user!} 
            messages={supportMessages} 
            chats={supportChats}
            allUsers={allUsers}
            activeChatId={activeSupportChatId}
            setActiveChatId={setActiveSupportChatId}
            onClose={() => setIsSupportOpen(false)}
            styles={styles}
            theme={theme}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function SupportChat({ 
  user, 
  messages, 
  chats, 
  allUsers,
  activeChatId, 
  setActiveChatId, 
  onClose, 
  styles, 
  theme 
}: { 
  user: UserProfile, 
  messages: SupportMessage[], 
  chats: Record<string, { lastMessage: string, userName: string, updatedAt: Date }>,
  allUsers: UserProfile[],
  activeChatId: string | null,
  setActiveChatId: (id: string | null) => void,
  onClose: () => void,
  styles: any,
  theme: Theme
}) {
  const [messageText, setMessageText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim()) return;

    const chatId = ['admin', 'supervisao'].includes(user.role as any) ? activeChatId : user.uid;
    if (!chatId) return;

    try {
      await addDoc(collection(db, 'support_messages'), {
        chatId,
        text: messageText,
        senderId: user.uid,
        senderName: user.name,
        senderRole: user.role,
        createdAt: serverTimestamp()
      });
      setMessageText('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'support_messages');
    }
  };

  const getUserName = (uid: string) => {
    const foundUser = allUsers.find(u => u.uid === uid);
    return foundUser ? foundUser.name : (chats[uid]?.userName || 'Usuário');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      className={`fixed bottom-20 left-6 z-[100] w-[calc(100vw-48px)] sm:w-[350px] h-[500px] max-h-[calc(100vh-120px)] rounded-2xl border shadow-2xl flex flex-col overflow-hidden ${styles.panel}`}
    >
      {/* Header */}
      <div className={`p-4 border-b flex items-center justify-between ${theme === 'black' ? 'bg-slate-800 border-slate-700' : 'bg-blue-600 text-white border-blue-500'}`}>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-white/20">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm">
              {['admin', 'supervisao'].includes(user.role as any) && activeChatId ? getUserName(activeChatId) : 'Suporte Técnico'}
            </h3>
            <p className="text-[10px] opacity-80">Reporte erros e bugs</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {['admin', 'supervisao'].includes(user.role as any) && !activeChatId ? (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <p className={`text-[10px] font-bold uppercase px-2 py-2 ${styles.muted}`}>Conversas Ativas</p>
            {Object.entries(chats).length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full opacity-40">
                <MessageSquare className="w-8 h-8 mb-2" />
                <p className="text-xs">Nenhuma conversa</p>
              </div>
            ) : (
              Object.entries(chats)
                .sort((a, b) => b[1].updatedAt.getTime() - a[1].updatedAt.getTime())
                .map(([id, chat]) => (
                <button
                  key={id}
                  onClick={() => setActiveChatId(id)}
                  className={`w-full text-left p-3 rounded-xl transition-all hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 group`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <p className={`font-bold text-xs ${styles.text}`}>{getUserName(id)}</p>
                    <span className="text-[8px] opacity-50">{format(chat.updatedAt, 'HH:mm')}</span>
                  </div>
                  <p className={`text-[10px] truncate ${styles.muted}`}>{chat.lastMessage}</p>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {['admin', 'supervisao'].includes(user.role as any) && (
              <button 
                onClick={() => setActiveChatId(null)}
                className={`p-2 text-[10px] font-bold flex items-center gap-2 border-b ${theme === 'black' ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-100'} ${styles.muted} hover:text-blue-600 transition-colors`}
              >
                <Plus className="w-3 h-3 rotate-45" /> Voltar para lista de chats
              </button>
            )}
            
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full opacity-40 text-center p-6">
                  <div className="p-4 rounded-full bg-slate-100 dark:bg-slate-800 mb-4">
                    <HelpCircle className="w-8 h-8 text-blue-600" />
                  </div>
                  <p className="text-sm font-bold mb-1">Olá! Como podemos ajudar?</p>
                  <p className="text-[10px]">Descreva o erro ou bug encontrado para que nossa equipe possa auxiliar.</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div 
                    key={msg.id}
                    className={`flex flex-col ${msg.senderId === user.uid ? 'items-end' : 'items-start'}`}
                  >
                    <div className={`max-w-[85%] p-3 rounded-2xl text-xs shadow-sm ${
                      msg.senderId === user.uid 
                        ? 'bg-blue-600 text-white rounded-tr-none' 
                        : theme === 'black' ? 'bg-slate-800 text-slate-200 rounded-tl-none' : 'bg-slate-100 text-slate-800 rounded-tl-none'
                    }`}>
                      {msg.text}
                    </div>
                    <span className="text-[9px] mt-1 opacity-50 px-1">
                      {msg.senderRole === 'admin' ? 'Suporte' : msg.senderName} • {format(msg.createdAt, 'HH:mm')}
                    </span>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleSendMessage} className={`p-3 border-t flex gap-2 ${theme === 'black' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'}`}>
              <input
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Digite sua mensagem..."
                className={`flex-1 text-xs p-2.5 rounded-xl border focus:ring-2 focus:ring-blue-500 outline-none transition-all ${styles.input}`}
              />
              <button 
                type="submit" 
                disabled={!messageText.trim()}
                className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function SidebarItem({ icon, label, active, onClick, count, themeStyles }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void, count?: number, themeStyles: any }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all ${
        active 
          ? 'bg-blue-600 text-white font-semibold shadow-md shadow-blue-500/20' 
          : themeStyles.sidebarItem
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={active ? 'text-white' : 'text-slate-400'}>{icon}</span>
        <span className="text-sm">{label}</span>
      </div>
      {count !== undefined && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? 'bg-white/20 text-white' : themeStyles.badge}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function LoginScreen({ setAuthError, authError }: { setAuthError: (err: string | null) => void, authError: string | null }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setAuthError(null);

    try {
      // Try to sign in anonymously for rules to work, but don't block the login query if it fails
      // as the current rules allow public read for the login check.
      try {
        if (!auth.currentUser) {
          await signInAnonymously(auth);
        }
      } catch (authErr) {
        console.warn('Falha na autenticação anônima (Firebase Auth):', authErr);
        // If it's a network error, we'll try to proceed with the query anyway
      }

      // Check if we need to bootstrap the admin user
      const usersRef = collection(db, 'users');
      let usersSnapshot;
      try {
        usersSnapshot = await getDocs(query(usersRef, limit(1)));
      } catch (queryErr: any) {
        if (queryErr.message?.includes('network-request-failed')) {
          throw new Error('Erro de conexão com o banco de dados. Verifique sua internet ou se há algum bloqueador de anúncios ativo.');
        }
        throw queryErr;
      }
      
      if (usersSnapshot.empty && username === 'admin' && password === '12345678') {
        // Bootstrap the default admin
        const adminData: UserProfile = {
          uid: auth.currentUser?.uid || 'admin_init',
          username: 'admin',
          password: '12345678',
          name: 'Administrador',
          role: 'admin',
          photoUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=admin`,
          notificationsEnabled: true,
          active: true
        };
        
        // Use UID as document ID for security rules to work
        const userUid = auth.currentUser?.uid || 'admin_init';
        await setDoc(doc(db, 'users', userUid), adminData);
        
        // Initialize metadata
        const metadataRef = doc(db, 'metadata', 'users');
        await setDoc(metadataRef, { count: 1 });
        
        localStorage.setItem('ticket_user', JSON.stringify(adminData));
        toast.success('Usuário Admin padrão criado e logado!');
        window.location.reload();
        return;
      }

      // Login logic
      const q = query(collection(db, 'users'), where('username', '==', username), where('password', '==', password), limit(1));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        throw new Error('Usuário ou senha incorretos.');
      }

      const userDoc = snapshot.docs[0];
      const userData = userDoc.data() as UserProfile;
      
      // Update the document with the current anonymous UID to maintain ownership
      // and ensure document ID matches UID for security rules
      if (auth.currentUser) {
        const currentUid = auth.currentUser.uid;
        const updatedUserData = {
          ...userData,
          uid: currentUid
        };
        
        // If document ID is not the UID, migrate it
        if (userDoc.id !== currentUid) {
          try {
            await deleteDoc(doc(db, 'users', userDoc.id));
            await setDoc(doc(db, 'users', currentUid), updatedUserData);
          } catch (migrateErr) {
            console.error('Erro ao migrar ID do usuário:', migrateErr);
            // Non-critical, proceed with login
          }
        } else {
          try {
            await setDoc(doc(db, 'users', currentUid), updatedUserData);
          } catch (updateErr) {
            console.error('Erro ao atualizar UID do usuário:', updateErr);
            // Non-critical, proceed with login
          }
        }
        
        userData.uid = currentUid;
      }

      localStorage.setItem('ticket_user', JSON.stringify(userData));
      toast.success(`Bem-vindo, ${userData.name}!`);
      window.location.reload();
    } catch (error: any) {
      let errorMessage = error.message;
      if (errorMessage.includes('auth/network-request-failed')) {
        errorMessage = 'Erro de rede ao conectar com o Firebase Auth. Verifique sua conexão ou extensões do navegador.';
      }
      setAuthError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20 mb-4">
            <FileText className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">TicketMaster</h1>
          <p className="text-slate-500 text-sm">Acesse sua conta para gerenciar chamados</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-slate-500">Usuário</label>
            <div className="relative">
              <LogIn className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                required 
                className="input-field pl-10 bg-white border border-slate-200" 
                placeholder="Nome de usuário"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-slate-500">Senha</label>
            <div className="relative">
              <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="password" 
                required 
                className="input-field pl-10 bg-white border border-slate-200" 
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {authError && (
            <div className="p-3 rounded-lg bg-rose-50 text-rose-600 text-xs font-medium border border-rose-100">
              {authError}
            </div>
          )}

          <button 
            type="submit" 
            disabled={isLoading}
            className="btn-primary w-full justify-center py-3 text-sm font-bold shadow-lg shadow-blue-500/20 disabled:opacity-50"
          >
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Entrar'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

// --- Admin Components ---

const AdminDashboard = ({ tickets, allUsers, styles, theme, currentTime }: { tickets: Ticket[], allUsers: UserProfile[], styles: any, theme: Theme, currentTime: Date }) => {
  const stats = useMemo(() => {
    const open = tickets.filter(t => t.status === 'Aberto').length;
    const inProgress = tickets.filter(t => t.status === 'Em Atendimento').length;
    const waiting = tickets.filter(t => t.status === 'Aguardando Validação').length;
    const waitingSupervision = tickets.filter(t => t.status === 'Aguardando Validação' && t.subticket === 'supervisao').length;
    const activeUsers = allUsers.filter(u => u.active !== false).length;
    
    const calculateAvgForSector = (sector: string) => {
      const activeTickets = tickets.filter(t => 
        t.sector === sector && 
        (t.status === 'Aberto' || t.status === 'Em Atendimento')
      );
      
      if (activeTickets.length === 0) return { h: 0, m: 0 };
      
      const totalDuration = activeTickets.reduce((acc, t) => {
        const start = new Date(t.complaintDateTime).getTime();
        return acc + (currentTime.getTime() - start);
      }, 0);
      
      const avgDuration = totalDuration / activeTickets.length;
      const h = Math.floor(avgDuration / (1000 * 60 * 60));
      const m = Math.floor((avgDuration % (1000 * 60 * 60)) / (1000 * 60));
      return { h, m };
    };

    const n2Avg = calculateAvgForSector('N2');
    const n3Avg = calculateAvgForSector('N3');

    const calculateAvgForStatus = (status: TicketStatus) => {
      const statusTickets = tickets.filter(t => t.status === status);
      if (statusTickets.length === 0) return { h: 0, m: 0 };
      
      const totalDuration = statusTickets.reduce((acc, t) => {
        const start = new Date(t.complaintDateTime).getTime();
        return acc + (currentTime.getTime() - start);
      }, 0);
      
      const avgDuration = totalDuration / statusTickets.length;
      const h = Math.floor(avgDuration / (1000 * 60 * 60));
      const m = Math.floor((avgDuration % (1000 * 60 * 60)) / (1000 * 60));
      return { h, m };
    };

    const waitingAvg = calculateAvgForStatus('Aguardando Validação');

    return { open, inProgress, waiting, waitingSupervision, n2Avg, n3Avg, waitingAvg, activeUsers };
  }, [tickets, allUsers, currentTime]);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-6">
        <div className={`p-6 rounded-2xl border ${styles.card} shadow-sm`}>
          <div className="flex items-center gap-4 mb-2">
            <div className="p-3 rounded-xl bg-emerald-100 text-emerald-600">
              <Users className="w-6 h-6" />
            </div>
            <h3 className={`font-bold ${styles.text}`}>Usuários Ativos</h3>
          </div>
          <p className="text-3xl font-black text-emerald-600">{stats.activeUsers}</p>
        </div>
        <div className={`p-6 rounded-2xl border ${styles.card} shadow-sm`}>
          <div className="flex items-center gap-4 mb-2">
            <div className="p-3 rounded-xl bg-blue-100 text-blue-600">
              <FileText className="w-6 h-6" />
            </div>
            <h3 className={`font-bold ${styles.text}`}>Em Aberto</h3>
          </div>
          <p className="text-3xl font-black text-blue-600">{stats.open}</p>
        </div>
        <div className={`p-6 rounded-2xl border ${styles.card} shadow-sm`}>
          <div className="flex items-center gap-4 mb-2">
            <div className="p-3 rounded-xl bg-amber-100 text-amber-600">
              <Timer className="w-6 h-6" />
            </div>
            <h3 className={`font-bold ${styles.text}`}>Em Atendimento</h3>
          </div>
          <p className="text-3xl font-black text-amber-600">{stats.inProgress}</p>
        </div>
        <div className={`p-6 rounded-2xl border ${styles.card} shadow-sm`}>
          <div className="flex items-center gap-4 mb-2">
            <div className="p-3 rounded-xl bg-purple-100 text-purple-600">
              <Clock className="w-6 h-6" />
            </div>
            <h3 className={`font-bold ${styles.text}`}>Aguardando Validação</h3>
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-black text-purple-600">{stats.waiting}</p>
            <div className="flex flex-col">
              <p className={`text-[10px] font-bold ${styles.muted}`}>Supervisão: {stats.waitingSupervision}</p>
              <p className={`text-[10px] font-bold ${styles.muted}`}>Média: {stats.waitingAvg.h}h {stats.waitingAvg.m}m</p>
            </div>
          </div>
        </div>
        <div className={`p-6 rounded-2xl border ${styles.card} shadow-sm`}>
          <div className="flex items-center gap-4 mb-2">
            <div className="p-3 rounded-xl bg-blue-100 text-blue-600">
              <Clock className="w-6 h-6" />
            </div>
            <h3 className={`font-bold ${styles.text}`}>TMA N2</h3>
          </div>
          <p className="text-3xl font-black text-blue-600">
            {stats.n2Avg.h}h {stats.n2Avg.m}m
          </p>
        </div>
        <div className={`p-6 rounded-2xl border ${styles.card} shadow-sm`}>
          <div className="flex items-center gap-4 mb-2">
            <div className="p-3 rounded-xl bg-purple-100 text-purple-600">
              <Clock className="w-6 h-6" />
            </div>
            <h3 className={`font-bold ${styles.text}`}>TMA N3</h3>
          </div>
          <p className="text-3xl font-black text-purple-600">
            {stats.n3Avg.h}h {stats.n3Avg.m}m
          </p>
        </div>
      </div>

      <div className={`p-6 rounded-2xl border ${styles.card} shadow-sm`}>
        <h3 className={`text-lg font-bold mb-6 ${styles.text}`}>Visão Geral dos Painéis</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { label: 'N2', count: tickets.filter(t => t.sector === 'N2' && t.status !== 'Concluído' && t.status !== 'Cancelado').length, color: 'text-blue-500' },
            { label: 'N3', count: tickets.filter(t => t.sector === 'N3' && t.status !== 'Concluído' && t.status !== 'Cancelado').length, color: 'text-purple-500' },
            { label: 'Backoffice', count: tickets.filter(t => t.subticket === 'backoffice' && t.status !== 'Concluído' && t.status !== 'Cancelado').length, color: 'text-amber-500' },
            { label: 'Supervisão', count: tickets.filter(t => t.subticket === 'supervisao' && t.status !== 'Concluído' && t.status !== 'Cancelado').length, color: 'text-indigo-500' },
            { label: 'Concluídos', count: tickets.filter(t => t.status === 'Concluído').length, color: 'text-emerald-500' },
            { label: 'Cancelados', count: tickets.filter(t => t.status === 'Cancelado').length, color: 'text-rose-500' },
          ].map((panel, idx) => (
            <div key={idx} className={`p-4 rounded-xl border ${theme === 'black' ? 'border-slate-800 bg-slate-900/50' : 'border-slate-100 bg-slate-50'} flex items-center justify-between`}>
              <span className={`font-bold ${styles.text}`}>{panel.label}</span>
              <span className={`text-xl font-black ${panel.color}`}>{panel.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const UserManagement = ({ allUsers, styles, theme }: { allUsers: UserProfile[], styles: any, theme: Theme }) => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [newUserData, setNewUserData] = useState({
    username: '',
    password: '',
    name: '',
    role: 'user' as 'user' | 'admin' | 'supervisao',
    active: true
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [suggestedPassword, setSuggestedPassword] = useState('');
  const [timer, setTimer] = useState(20);

  const generatePassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setSuggestedPassword(result);
    setTimer(20);
  };

  useEffect(() => {
    let interval: any;
    if (isFormOpen) {
      generatePassword();
      interval = setInterval(() => {
        setTimer((prev) => {
          if (prev <= 1) {
            generatePassword();
            return 20;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isFormOpen]);

  const handleSubmitUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (editingUser) {
        // Update existing user
        const userRef = doc(db, 'users', editingUser.uid);
        
        // Check if username changed and if new one is taken
        if (newUserData.username !== editingUser.username) {
          const q = query(collection(db, 'users'), where('username', '==', newUserData.username), limit(1));
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
            throw new Error('Este nome de usuário já está em uso.');
          }
        }

        await updateDoc(userRef, {
          name: newUserData.name,
          username: newUserData.username,
          password: newUserData.password,
          role: newUserData.role,
          active: newUserData.active
        });

        toast.success('Usuário atualizado com sucesso!');
      } else {
        // Create new user with transaction to enforce limit
        await runTransaction(db, async (transaction) => {
          const metadataRef = doc(db, 'metadata', 'users');
          const metadataDoc = await transaction.get(metadataRef);
          
          let currentCount = 0;
          if (metadataDoc.exists()) {
            currentCount = metadataDoc.data().count;
          }
          
          if (currentCount >= 30) {
            throw new Error('Limite de 30 usuários atingido.');
          }

          // Check username uniqueness
          const q = query(collection(db, 'users'), where('username', '==', newUserData.username), limit(1));
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
            throw new Error('Este nome de usuário já está em uso.');
          }

          const newUserRef = doc(collection(db, 'users'));
          const newUser: UserProfile = {
            uid: newUserRef.id,
            username: newUserData.username,
            password: newUserData.password,
            name: newUserData.name,
            role: newUserData.role,
            photoUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${newUserRef.id}`,
            notificationsEnabled: true,
            active: true
          };

          transaction.set(newUserRef, newUser);
          transaction.set(metadataRef, { count: currentCount + 1 }, { merge: true });
        });

        toast.success('Usuário criado com sucesso!');
      }
      
      setIsFormOpen(false);
      setEditingUser(null);
      setNewUserData({ username: '', password: '', name: '', role: 'user', active: true });
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEditUser = (u: UserProfile) => {
    setEditingUser(u);
    setNewUserData({
      username: u.username,
      password: u.password || '',
      name: u.name,
      role: u.role as any,
      active: u.active !== false
    });
    setIsFormOpen(true);
  };

  const handleDeleteUser = (uid: string) => {
    setUserToDelete(uid);
  };

  const confirmDeleteUser = async () => {
    if (!userToDelete) return;
    try {
      await runTransaction(db, async (transaction) => {
        const metadataRef = doc(db, 'metadata', 'users');
        const metadataDoc = await transaction.get(metadataRef);
        
        let currentCount = 0;
        if (metadataDoc.exists()) {
          currentCount = metadataDoc.data().count;
        }

        transaction.delete(doc(db, 'users', userToDelete));
        transaction.set(metadataRef, { count: Math.max(0, currentCount - 1) }, { merge: true });
      });
      toast.success('Usuário excluído com sucesso!');
    } catch (err) {
      console.error('Erro ao excluir usuário:', err);
      toast.error('Erro ao excluir usuário');
    } finally {
      setUserToDelete(null);
    }
  };

  const handleResetDatabase = async () => {
    if (!window.confirm('TEM CERTEZA? Isso excluirá TODOS os chamados e resetará as estatísticas. Os usuários permanecerão, mas o contador será resetado para o número atual de usuários.')) return;
    
    setLoading(true);
    try {
      // Delete all tickets
      const ticketsQuery = query(collection(db, 'tickets'));
      const ticketsSnapshot = await getDocs(ticketsQuery);
      const deletePromises = ticketsSnapshot.docs.map(d => deleteDoc(doc(db, 'tickets', d.id)));
      await Promise.all(deletePromises);
      
      // Reset user count metadata based on current users
      const usersQuery = query(collection(db, 'users'));
      const usersSnapshot = await getDocs(usersQuery);
      const currentCount = usersSnapshot.size;
      
      await setDoc(doc(db, 'metadata', 'users'), { count: currentCount });
      
      toast.success('Banco de dados resetado com sucesso!');
    } catch (err: any) {
      toast.error('Erro ao resetar banco: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex flex-col">
          <p className={`text-sm ${styles.muted}`}>Total de usuários: {allUsers.length}</p>
          <div className="flex gap-2">
            <button 
              onClick={() => window.location.reload()}
              className="text-[10px] text-blue-500 hover:underline text-left mt-1"
            >
              Atualizar lista
            </button>
            {auth.currentUser?.email === 'iandroromulo2001@gmail.com' && (
              <button 
                onClick={handleResetDatabase}
                className="text-[10px] text-rose-500 hover:underline text-left mt-1"
              >
                Resetar Banco
              </button>
            )}
          </div>
        </div>
        <button 
          onClick={() => {
            setEditingUser(null);
            setNewUserData({ username: '', password: '', name: '', role: 'user', active: true });
            setIsFormOpen(true);
          }}
          className="btn-primary"
        >
          <Plus className="w-5 h-5" /> Adicionar Usuário
        </button>
      </div>

      <AnimatePresence>
        {isFormOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`p-6 rounded-2xl border ${styles.card} shadow-xl max-w-md mx-auto`}
          >
            <h3 className={`text-lg font-bold mb-4 ${styles.text}`}>
              {editingUser ? 'Editar Usuário' : 'Novo Usuário'}
            </h3>
            <form onSubmit={handleSubmitUser} className="space-y-4">
              <div>
                <label className={`block text-sm font-bold mb-1 ${styles.text}`}>Nome Completo</label>
                <input 
                  type="text" 
                  required
                  className={`input-field w-full ${styles.input}`}
                  value={newUserData.name}
                  onChange={e => setNewUserData({...newUserData, name: e.target.value})}
                />
              </div>
              <div>
                <label className={`block text-sm font-bold mb-1 ${styles.text}`}>Usuário (Login)</label>
                <input 
                  type="text" 
                  required
                  className={`input-field w-full ${styles.input}`}
                  value={newUserData.username}
                  onChange={e => setNewUserData({...newUserData, username: e.target.value})}
                />
              </div>
              <div>
                <label className={`block text-sm font-bold mb-1 ${styles.text}`}>Senha</label>
                <input 
                  type="password" 
                  required
                  minLength={6}
                  className={`input-field w-full ${styles.input}`}
                  value={newUserData.password}
                  onChange={e => setNewUserData({...newUserData, password: e.target.value})}
                />
                <p className="text-[10px] text-slate-400 mt-1">Mínimo de 6 caracteres</p>
                
                {/* Senha Sugerida */}
                <div className={`mt-2 p-4 rounded-xl border ${theme === 'black' ? 'bg-slate-900/50 border-slate-800' : 'bg-slate-50 border-slate-100'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-slate-400" />
                      <span className={`text-[11px] font-bold uppercase tracking-wider ${styles.muted}`}>Sugestão ({timer}s)</span>
                    </div>
                    <span className="text-lg font-mono font-black text-blue-600 dark:text-blue-400 select-all tracking-wider">{suggestedPassword}</span>
                  </div>
                  <div className={`h-1.5 w-full rounded-full overflow-hidden ${theme === 'black' ? 'bg-slate-800' : 'bg-slate-200'}`}>
                    <motion.div 
                      key={suggestedPassword}
                      initial={{ width: '100%' }}
                      animate={{ width: '0%' }}
                      transition={{ duration: 20, ease: 'linear' }}
                      className="h-full bg-blue-600"
                    />
                  </div>
                  <button 
                    type="button"
                    onClick={() => setNewUserData({...newUserData, password: suggestedPassword})}
                    className="mt-3 w-full text-xs font-bold text-blue-600 hover:text-blue-700 transition-colors flex items-center justify-center gap-2 py-2 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-transparent hover:border-blue-100 dark:hover:border-blue-800"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Usar esta senha
                  </button>
                </div>
              </div>
              <div>
                <label className={`block text-sm font-bold mb-1 ${styles.text}`}>Cargo</label>
                <select 
                  className={`input-field w-full ${styles.input}`}
                  value={newUserData.role}
                  onChange={e => setNewUserData({...newUserData, role: e.target.value as any})}
                >
                  <option value="user">Usuário Padrão</option>
                  <option value="admin">Administrador</option>
                  <option value="supervisao">Supervisão</option>
                </select>
              </div>
              <div className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                <input 
                  type="checkbox" 
                  id="active-toggle"
                  className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                  checked={newUserData.active}
                  onChange={e => setNewUserData({...newUserData, active: e.target.checked})}
                />
                <label htmlFor="active-toggle" className={`text-sm font-bold ${styles.text}`}>Usuário Ativo</label>
              </div>
              {error && <p className="text-rose-500 text-sm font-medium">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button 
                  type="button"
                  onClick={() => {
                    setIsFormOpen(false);
                    setEditingUser(null);
                  }}
                  className={`flex-1 px-4 py-2 rounded-xl font-bold transition-all ${theme === 'black' ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  disabled={loading}
                  className="flex-1 btn-primary"
                >
                  {loading ? (editingUser ? 'Atualizando...' : 'Criando...') : (editingUser ? 'Atualizar Usuário' : 'Criar Usuário')}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={`rounded-2xl border overflow-hidden ${styles.card}`}>
        <table className="w-full text-left">
          <thead>
            <tr className={`border-b ${theme === 'black' ? 'border-slate-800 bg-slate-900/50' : 'border-slate-100 bg-slate-50'}`}>
              <th className={`px-6 py-4 text-sm font-bold ${styles.text}`}>Usuário</th>
              <th className={`px-6 py-4 text-sm font-bold ${styles.text}`}>Login</th>
              <th className={`px-6 py-4 text-sm font-bold ${styles.text}`}>Cargo</th>
              <th className={`px-6 py-4 text-sm font-bold ${styles.text}`}>Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {allUsers.map(u => (
              <tr key={u.uid} className={`hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors`}>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <img src={u.photoUrl} alt={u.name} className="w-8 h-8 rounded-full" />
                    <span className={`font-medium ${styles.text}`}>{u.name}</span>
                  </div>
                </td>
                <td className={`px-6 py-4 text-sm ${styles.muted}`}>{u.username}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                    u.role === 'admin' ? 'bg-purple-100 text-purple-600' : 
                    u.role === 'supervisao' ? 'bg-indigo-100 text-indigo-600' :
                    'bg-blue-100 text-blue-600'
                  }`}>
                    {u.role === 'admin' ? 'Admin' : u.role === 'supervisao' ? 'Supervisão' : 'Usuário'}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => handleEditUser(u)}
                      className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                      title="Editar Usuário"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => handleDeleteUser(u.uid)}
                      className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                      title="Excluir Usuário"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal de Confirmação de Exclusão */}
      <AnimatePresence>
        {userToDelete && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={`max-w-sm w-full p-6 rounded-2xl border shadow-2xl text-center ${styles.card}`}
            >
              <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h3 className={`text-xl font-bold mb-2 ${styles.text}`}>Tem certeza que deseja excluir?</h3>
              <p className={`text-sm mb-6 ${styles.muted}`}>
                Esta ação não pode ser desfeita. O usuário perderá acesso permanentemente.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setUserToDelete(null)}
                  className="flex-1 px-4 py-2 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={confirmDeleteUser}
                  className={`flex-1 px-4 py-2 rounded-xl font-bold transition-colors ${theme === 'black' ? 'bg-slate-800 text-rose-500 hover:bg-slate-700' : 'bg-rose-50 text-rose-600 hover:bg-rose-100'}`}
                >
                  Sim
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

function UserStatsModal({ isOpen, onClose, allUsers, tickets, styles, theme }: { 
  isOpen: boolean, 
  onClose: () => void, 
  allUsers: UserProfile[], 
  tickets: Ticket[],
  styles: any,
  theme: Theme
}) {
  if (!isOpen) return null;

  const userStats = allUsers.map(u => {
    const userTickets = tickets.filter(t => t.responsible === u.name);
    return {
      ...u,
      total: userTickets.length,
      completed: userTickets.filter(t => t.status === 'Concluído').length,
      waiting: userTickets.filter(t => t.status === 'Aguardando Validação').length
    };
  }).sort((a, b) => b.total - a.total);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className={`relative w-full max-w-4xl max-h-[80vh] overflow-hidden rounded-2xl border shadow-2xl flex flex-col ${styles.panel}`}
      >
        <div className={`p-6 border-b flex items-center justify-between ${theme === 'black' ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-100'}`}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100 text-blue-600">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h2 className={`text-xl font-bold ${styles.text}`}>Estatísticas de Usuários</h2>
              <p className={`text-xs ${styles.muted}`}>Resumo de pendências e produtividade</p>
            </div>
          </div>
          <button onClick={onClose} className={`p-2 rounded-lg transition-colors ${theme === 'black' ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}>
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className={`p-4 rounded-xl border ${theme === 'black' ? 'bg-slate-800/50 border-slate-700' : 'bg-blue-50 border-blue-100'}`}>
              <p className={`text-xs font-bold uppercase ${styles.muted}`}>Total de Usuários</p>
              <p className={`text-2xl font-black ${styles.text}`}>{allUsers.length}</p>
            </div>
            <div className={`p-4 rounded-xl border ${theme === 'black' ? 'bg-slate-800/50 border-slate-700' : 'bg-emerald-50 border-emerald-100'}`}>
              <p className={`text-xs font-bold uppercase ${styles.muted}`}>Usuários Ativos</p>
              <p className={`text-2xl font-black text-emerald-600`}>{allUsers.filter(u => u.active !== false).length}</p>
            </div>
            <div className={`p-4 rounded-xl border ${theme === 'black' ? 'bg-slate-800/50 border-slate-700' : 'bg-rose-50 border-rose-100'}`}>
              <p className={`text-xs font-bold uppercase ${styles.muted}`}>Usuários Inativos</p>
              <p className={`text-2xl font-black text-rose-600`}>{allUsers.filter(u => u.active === false).length}</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className={`border-b ${theme === 'black' ? 'border-slate-800' : 'border-slate-100'}`}>
                  <th className={`pb-4 font-bold text-xs uppercase tracking-wider ${styles.muted}`}>Usuário</th>
                  <th className={`pb-4 font-bold text-xs uppercase tracking-wider ${styles.muted}`}>Cargo</th>
                  <th className={`pb-4 font-bold text-xs uppercase tracking-wider text-center ${styles.muted}`}>Status</th>
                  <th className={`pb-4 font-bold text-xs uppercase tracking-wider text-center ${styles.muted}`}>Total</th>
                  <th className={`pb-4 font-bold text-xs uppercase tracking-wider text-center ${styles.muted}`}>Concluídos</th>
                  <th className={`pb-4 font-bold text-xs uppercase tracking-wider text-center ${styles.muted}`}>Aguardando</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {userStats.map((u) => (
                  <tr key={u.uid} className="group hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-4">
                      <div className="flex items-center gap-3">
                        <img src={u.photoUrl} alt="" className="w-8 h-8 rounded-full border border-slate-200" />
                        <span className={`font-bold text-sm ${styles.text}`}>{u.name}</span>
                      </div>
                    </td>
                    <td className="py-4">
                      <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${
                        u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 
                        u.role === 'supervisao' ? 'bg-indigo-100 text-indigo-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {u.role === 'admin' ? 'Admin' : u.role === 'supervisao' ? 'Supervisão' : 'Usuário'}
                      </span>
                    </td>
                    <td className="py-4 text-center">
                      <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${
                        u.active !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                      }`}>
                        {u.active !== false ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="py-4 text-center">
                      <span className={`text-sm font-black ${styles.text}`}>{u.total}</span>
                    </td>
                    <td className="py-4 text-center">
                      <span className="text-sm font-black text-emerald-600">{u.completed}</span>
                    </td>
                    <td className="py-4 text-center">
                      <span className="text-sm font-black text-purple-600">{u.waiting}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
