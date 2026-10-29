import * as SecureStore from 'expo-secure-store';
import { api, Receipt } from './api';

const indexKey = 'cwash.references.v1';
const key = (ref:string) => `cwash.receipt.${ref}`;
// Store the small receipt and its bearer key in OS-protected storage, never logs.
export async function saveReceipt(receipt:Receipt) {
  await SecureStore.setItemAsync(key(receipt.reference), JSON.stringify(receipt));
  const references:string[] = JSON.parse(await SecureStore.getItemAsync(indexKey) || '[]');
  const updated = [receipt.reference,...references.filter(r=>r!==receipt.reference)];
  // Bounded index fits the native secure-storage item limit. Keep the latest 40.
  await SecureStore.setItemAsync(indexKey, JSON.stringify(updated.slice(0,40)));
  for (const ref of updated.slice(40)) await SecureStore.deleteItemAsync(key(ref));
}
export async function loadReceipts():Promise<Receipt[]> {
  const references:string[] = JSON.parse(await SecureStore.getItemAsync(indexKey) || '[]');
  const records = await Promise.all(references.map(ref=>SecureStore.getItemAsync(key(ref))));
  return records.filter((value):value is string=>value!==null).map(value=>JSON.parse(value));
}
export async function refreshReceipt(receipt:Receipt) {
  const {booking} = await api<{booking:Receipt}>(`/api/bookings/${encodeURIComponent(receipt.reference)}`,{headers:{Authorization:`Bearer ${receipt.accessToken}`}});
  const result = {...booking,accessToken:receipt.accessToken};
  await SecureStore.setItemAsync(key(receipt.reference),JSON.stringify(result));
  return result;
}
