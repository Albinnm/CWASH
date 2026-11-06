export type Service = {id:string;name:string;description:string;price:number;duration:number;features:string[]};
export type Vehicle = {id:string;name:string;surcharge:number;durationExtra:number};
export type Catalog = {membershipService?:Service;services:Service[];vehicles:Vehicle[];settings:{preview:boolean;zipPrefixes:string[]}};
export type Receipt = {coverage?:'membership'|'standard';membershipIncluded?:boolean;reference:string;status:string;serviceName:string;vehicleName:string;date:string;time:string;total:number;duration:number;accessToken?:string};
export class ApiError extends Error {
  constructor(message:string, public status:number) { super(message); this.name='ApiError'; }
}

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');
export const configurationError = !API_URL ? 'Set EXPO_PUBLIC_API_URL in mobile/.env to your CWASH server address, then restart Expo.' : !/^https?:\/\//.test(API_URL) ? 'The server address must start with https:// or http://.' : !__DEV__ && !API_URL.startsWith('https://') ? 'Release builds require an HTTPS server address.' : '';
export async function api<T>(path:string, options:RequestInit = {}):Promise<T> {
  if (configurationError) throw new Error(configurationError);
  if (!path.startsWith('/api/') || path.includes('://')) throw new Error('Invalid API path.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API_URL}${path}`, {...options, credentials:'omit', signal:controller.signal, headers:{'Content-Type':'application/json', ...options.headers}});
    const data = await response.json();
    if (!response.ok) throw new ApiError(data.error || 'Unable to complete this request.', response.status);
    return data;
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.message === 'Network request failed')) throw new Error('Cannot reach CWASH. Check your connection and try again.');
    throw error;
  } finally { clearTimeout(timeout); }
}
export const dollars = (value:number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value);
export const nyDate = (date=new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export const dateLabel = (date:string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric',weekday:'short'});
export const timeLabel = (time:string) => {const [h,m]=time.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;};
