import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { api, ApiError, API_URL } from './api';

export type Customer = {id:string;firstName:string;lastName:string;email:string;phone:string};
type RegisterInput = {firstName:string;lastName:string;email:string;phone:string;password:string};
type Session = {status:'loading'|'guest'|'authenticated'|'error';user:Customer|null;token:string|null;notice:string};
type CustomerContextValue = Session & {
  login:(email:string,password:string)=>Promise<void>;
  register:(input:RegisterInput)=>Promise<void>;
  logout:()=>Promise<void>;
  retry:()=>Promise<void>;
  request:<T>(path:string,options?:RequestInit)=>Promise<T>;
  updateProfile:(input:Pick<Customer,'firstName'|'lastName'|'phone'>)=>Promise<void>;
  changePassword:(currentPassword:string,newPassword:string)=>Promise<void>;
};
export const CUSTOMER_SESSION_KEY='cwash.customer.session.v1';
const initial:Session={status:'loading',user:null,token:null,notice:''};
const Context=createContext<CustomerContextValue|null>(null);

export function CustomerProvider({children}:{children:React.ReactNode}) {
  const [session,setSession]=useState<Session>(initial);
  const current=useRef(session);
  const commit=useCallback((next:Session)=>{current.current=next;setSession(next);},[]);
  const generation=useRef(0);
  const authenticating=useRef(false);
  const restore=useCallback(async()=>{
    const version=++generation.current;
    try {
      const raw=await SecureStore.getItemAsync(CUSTOMER_SESSION_KEY);
      if(version!==generation.current)return;
      if(!raw){commit({status:'guest',user:null,token:null,notice:''});return;}
      let saved:{origin?:string;token?:string}={};
      try{saved=JSON.parse(raw)??{};}catch{/* A damaged saved session can be safely discarded. */}
      if(saved.origin!==API_URL||typeof saved.token!=='string'||!/^[a-f0-9]{64}$/.test(saved.token)){await SecureStore.deleteItemAsync(CUSTOMER_SESSION_KEY);if(version===generation.current)commit({status:'guest',user:null,token:null,notice:'Sign in to your account on this server.'});return;}
      const result=await api<{authenticated:boolean;user?:Customer}>('/api/customer/session',{headers:{Authorization:`Bearer ${saved.token}`}});
      if(version!==generation.current)return;
      if(!result.authenticated||!result.user){await SecureStore.deleteItemAsync(CUSTOMER_SESSION_KEY);if(version===generation.current)commit({status:'guest',user:null,token:null,notice:'Your session expired. Please sign in again.'});return;}
      commit({status:'authenticated',user:result.user,token:saved.token,notice:''});
    }catch(error){if(version===generation.current)commit({status:'error',user:null,token:null,notice:`Unable to restore your account. ${(error as Error).message}`});}
  },[commit]);
  useEffect(()=>{
    let active=true;
    const counter=generation;
    void Promise.resolve().then(()=>{if(active)void restore();});
    return()=>{active=false;counter.current++;};
  },[restore]);
  const request=useCallback(async<T,>(path:string,options:RequestInit={}):Promise<T>=>{
    const state=current.current,version=generation.current;
    if(state.status==='loading'||state.status==='error')throw new Error('Please reconnect your account before continuing.');
    try{
      const result=await api<T>(path,{...options,headers:{...options.headers,...(state.token?{Authorization:`Bearer ${state.token}`}:{})}});
      if(version!==generation.current)throw new Error('Your account changed. Please try again.');
      return result;
    }
    catch(error){
      if(error instanceof ApiError&&error.status===401&&state.token&&version===generation.current){
        generation.current++;
        try{await SecureStore.deleteItemAsync(CUSTOMER_SESSION_KEY);commit({status:'guest',user:null,token:null,notice:'Your session expired. Sign in again before continuing.'});}
        catch{commit({status:'error',user:null,token:null,notice:'Could not clear your expired account session. Please retry.'});}
      }
      throw error;
    }
  },[commit]);
  async function authenticate(path:string,input:Record<string,string>){
    if(authenticating.current)throw new Error('Sign-in is already in progress.');
    authenticating.current=true;
    try{
      const version=++generation.current;
      const result=await api<{user:Customer;token:string}>(path,{method:'POST',body:JSON.stringify({...input,client:'mobile'})});
      if(!result.token||!result.user)throw new Error('The server did not return a valid customer session.');
      if(version!==generation.current){
        await api('/api/customer/logout',{method:'POST',headers:{Authorization:`Bearer ${result.token}`},body:'{}'}).catch(()=>{});
        throw new Error('Your account changed. Please sign in again.');
      }
      try{await SecureStore.setItemAsync(CUSTOMER_SESSION_KEY,JSON.stringify({origin:API_URL,token:result.token}));}
      catch{
        await api('/api/customer/logout',{method:'POST',headers:{Authorization:`Bearer ${result.token}`},body:'{}'}).catch(()=>{});
        throw new Error('Your account session could not be saved securely on this phone. Please try again.');
      }
      if(version===generation.current)commit({status:'authenticated',user:result.user,token:result.token,notice:''});
    }finally{authenticating.current=false;}
  }
  async function clearSession(){
    generation.current++;
    try{await SecureStore.deleteItemAsync(CUSTOMER_SESSION_KEY);commit({status:'guest',user:null,token:null,notice:''});}
    catch{commit({status:'error',user:null,token:null,notice:'Your server session ended, but local secure storage could not be cleared. Retry before continuing.'});throw new Error('Could not clear the saved sign-in on this phone.');}
  }
  async function logout(){await request('/api/customer/logout',{method:'POST',body:'{}'});await clearSession();}
  async function updateProfile(input:Pick<Customer,'firstName'|'lastName'|'phone'>){const version=generation.current;const result=await request<{user:Customer}>('/api/customer/profile',{method:'PATCH',body:JSON.stringify(input)});if(version===generation.current)commit({...current.current,user:result.user});}
  async function changePassword(currentPassword:string,newPassword:string){await request('/api/customer/password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})});await clearSession();}
  return <Context.Provider value={{...session,request,retry:restore,login:(email,password)=>authenticate('/api/customer/login',{email,password}),register:input=>authenticate('/api/customer/register',input),logout,updateProfile,changePassword}}>{children}</Context.Provider>;
}
export function useCustomer(){const value=useContext(Context);if(!value)throw new Error('CustomerProvider is required.');return value;}
