// Same-origin by default: Vite proxies /api to the backend (see vite.config.ts),
// which avoids CORS issues and works on LAN devices. Override with VITE_API_URL if needed.
const API = import.meta.env.VITE_API_URL || '/api';

function errorMessage(detail: unknown): string {
	if (typeof detail === 'string') return detail;
	if (Array.isArray(detail)) {
		return detail
			.map((item: any) => item?.msg || item?.message)
			.filter(Boolean)
			.join('. ') || 'Please check the entered details.';
	}
	if (detail && typeof detail === 'object') {
		return String((detail as any).message || (detail as any).msg || 'Request failed');
	}
	return 'Request failed';
}

export async function api(path:string, options:RequestInit={}){
	const token=localStorage.getItem('customer_token');
	const headers=new Headers(options.headers);
	if(!headers.has('Content-Type')&&options.body) headers.set('Content-Type','application/json');
	if(token) headers.set('Authorization',`Bearer ${token}`);
	const r=await fetch(API+path,{...options,headers});
	const data=await r.json().catch(()=>({}));
	if(!r.ok){
		// Stale/invalid session: clear it so the app falls back to the login screen
		// instead of showing "Invalid or expired token" on every request.
		if(r.status===401 && token && !path.startsWith('/auth/')){
			localStorage.removeItem('customer_token');
			localStorage.removeItem('customer_profile');
			window.location.reload();
		}
		throw new Error(errorMessage(data.detail));
	}
	return data;
}
