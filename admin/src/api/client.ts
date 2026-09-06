// API base. For the Android APK build set VITE_ADMIN_API_URL in admin/.env to
// your machine's LAN address (e.g. http://192.168.1.5:8000/api) so the app on
// the phone can reach the backend running on this PC.
/// <reference types="vite/client" />
const API = import.meta.env.VITE_ADMIN_API_URL || 'http://localhost:8000/api';
function errorMessage(detail: unknown): string { if (typeof detail === 'string') return detail; if (Array.isArray(detail)) return detail.map((item: any) => item?.msg || item?.message).filter(Boolean).join('. ') || 'Please check the entered details.'; return 'Request failed'; }
export async function api(path:string,options:RequestInit={}){const t=sessionStorage.getItem('admin_token');const h=new Headers(options.headers);if(options.body&&!h.has('Content-Type'))h.set('Content-Type','application/json');if(t)h.set('Authorization',`Bearer ${t}`);const r=await fetch(API+path,{...options,headers:h});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(errorMessage(d.detail));return d}
