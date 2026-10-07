// ============================================
// CRYPTONOTE — Supabase Client & Auth
// Supports: Email/Password + Google OAuth
// ============================================

const SUPABASE_URL = 'https://gapczaztckntejjfgisj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdhcGN6YXp0Y2tudGVqamZnaXNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMTc2MzYsImV4cCI6MjEwNjc5MzYzNn0.Emk6O_1HIRSeqxj5kcrm0vnCgRhr-5ZdxhAQ0I6gzjU';

const supabaseClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const Auth = {
  currentUser: null,

  async init() {
    if (!supabaseClient) return;

    const { data: { session } } = await supabaseClient.auth.getSession();
    this.currentUser = session?.user || null;
    this.updateUI();

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      const prevUser = this.currentUser;
      this.currentUser = session?.user || null;
      this.updateUI();

      // Close auth overlay on login
      if (!prevUser && this.currentUser) {
        const overlay = document.getElementById('auth-modal-overlay');
        if (overlay) overlay.classList.remove('open');
      }

      if (window.App && typeof window.App.onAuthChange === 'function') {
        await window.App.onAuthChange(this.currentUser);
      }
    });
  },

  isLoggedIn() {
    return !!this.currentUser;
  },

  async signUp(email, password, displayName = '') {
    if (!supabaseClient) throw new Error('Supabase no inicializado');
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName || email.split('@')[0] },
      },
    });
    if (error) throw error;
    return data;
  },

  async signIn(email, password) {
    if (!supabaseClient) throw new Error('Supabase no inicializado');
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.currentUser = data.user;
    return data;
  },

  async signInWithGoogle() {
    if (!supabaseClient) throw new Error('Supabase no inicializado');
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.href,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });
    if (error) throw error;
  },

  async signOut() {
    if (!supabaseClient) return;
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    this.currentUser = null;
    this.updateUI();
  },

  async sendPasswordResetEmail(email) {
    if (!supabaseClient) throw new Error('Supabase no inicializado');
    // redirectTo points back to this same page — Supabase appends #type=recovery to it
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  },

  async updatePassword(newPassword) {
    if (!supabaseClient) throw new Error('Supabase no inicializado');
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) throw error;
  },

  getDisplayName() {
    if (!this.currentUser) return '';
    return (
      this.currentUser.user_metadata?.full_name ||
      this.currentUser.user_metadata?.display_name ||
      this.currentUser.email ||
      ''
    );
  },

  getAvatarUrl() {
    return this.currentUser?.user_metadata?.avatar_url || null;
  },

  updateUI() {
    const authLoggedOut = document.getElementById('auth-logged-out');
    const authLoggedIn  = document.getElementById('auth-logged-in');
    const userEmailEl   = document.getElementById('user-email-display');
    const userAvatarEl  = document.getElementById('user-avatar-initials');

    if (this.currentUser) {
      if (authLoggedOut) authLoggedOut.style.display = 'none';
      if (authLoggedIn)  authLoggedIn.style.display  = 'flex';

      const name     = this.getDisplayName();
      const avatar   = this.getAvatarUrl();

      if (userEmailEl) userEmailEl.textContent = name;

      if (userAvatarEl) {
        if (avatar) {
          userAvatarEl.innerHTML = `<img src="${avatar}" style="width:26px;height:26px;border-radius:50%;object-fit:cover" alt="avatar">`;
        } else {
          const initials = (name.substring(0, 2) || 'US').toUpperCase();
          userAvatarEl.textContent = initials;
        }
      }
    } else {
      if (authLoggedOut) authLoggedOut.style.display = 'flex';
      if (authLoggedIn)  authLoggedIn.style.display  = 'none';
    }
  },
};
