import React, { useState } from 'react';
import { AppState, Button, Text } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import Account from '../src/app/account';
import Bookings from '../src/app/bookings';
import { api, ApiError, API_URL } from '../src/lib/api';
import { CustomerProvider, CUSTOMER_SESSION_KEY, useCustomer } from '../src/lib/customer';
import { loadReceipts, refreshReceipt } from '../src/lib/receipts';

jest.mock('expo-router',()=>({
  router:{navigate:jest.fn()},
  useFocusEffect(effect:()=>void|(()=>void)){
    const React=jest.requireActual('react');
    React.useEffect(effect,[effect]);
  },
}));
jest.mock('react-native-safe-area-context',()=>jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-secure-store',()=>({getItemAsync:jest.fn(),setItemAsync:jest.fn(),deleteItemAsync:jest.fn()}));
jest.mock('../src/lib/api',()=>({...jest.requireActual('../src/lib/api'),API_URL:'https://cwash.example.test',api:jest.fn()}));
jest.mock('../src/lib/receipts',()=>({loadReceipts:jest.fn(),refreshReceipt:jest.fn()}));

const user={id:'customer-one',firstName:'Test',lastName:'Customer',email:'test@example.test',phone:'2125550100'};
const token='a'.repeat(64);
const password='Test-only-password-42!';
const receipt={reference:'CW-ACCOUNT123',status:'pending',serviceName:'Full detail',vehicleName:'Sedan',date:'2026-11-10',time:'09:00',total:199,duration:180};
const guestReceipt={...receipt,reference:'CW-GUEST456',accessToken:'guest-key'};

beforeEach(()=>{
  jest.resetAllMocks();
  jest.spyOn(AppState,'addEventListener').mockReturnValue({remove:jest.fn()});
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  (loadReceipts as jest.Mock).mockResolvedValue([guestReceipt]);
  (refreshReceipt as jest.Mock).mockImplementation(async value=>({...value,status:'confirmed'}));
  (api as jest.Mock).mockImplementation(async(path:string)=>{
    if(path==='/api/customer/session')return {authenticated:true,user};
    if(['/api/customer/login','/api/customer/register'].includes(path))return {user,token};
    if(path==='/api/customer/logout')return {ok:true};
    if(path==='/api/customer/bookings')return {bookings:[receipt]};
    if(path==='/api/customer/billing')return {enabled:false,mode:null,plan:null,membership:null,canManage:false,payments:[]};
    throw new Error(`Unexpected API request: ${path}`);
  });
});

function Probe(){
  const auth=useCustomer();
  const [error,setError]=useState('');
  return <><Text testID="session-status">{auth.status}</Text><Text testID="request-error">{error}</Text><Button title="Send account request" onPress={()=>{void auth.request('/api/bookings',{method:'POST',body:'{}'}).catch(e=>setError(e.message));}}/></>;
}

function savedSession(origin=API_URL){
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify({origin,token}));
}

async function fillLogin(){
  await screen.findByText('Welcome back.');
  await fireEvent.changeText(screen.getByLabelText('Email address'),user.email);
  await fireEvent.changeText(screen.getByLabelText('Password'),password);
  await fireEvent.press(screen.getByText('Sign in to my account'));
}

test('native signup stores only the server-bound session token and opens the customer profile',async()=>{
  await render(<CustomerProvider><Account/></CustomerProvider>);
  await screen.findByText('Welcome back.');
  await fireEvent.press(screen.getByText('Create account'));
  await fireEvent.changeText(screen.getByLabelText('First name'),user.firstName);
  await fireEvent.changeText(screen.getByLabelText('Last name'),user.lastName);
  await fireEvent.changeText(screen.getByLabelText('Email address'),` ${user.email} `);
  await fireEvent.changeText(screen.getByLabelText('Phone number (optional)'),user.phone);
  await fireEvent.changeText(screen.getByLabelText('Password'),password);
  await fireEvent.changeText(screen.getByLabelText('Confirm password'),password);
  await fireEvent.press(screen.getByText('Create my account'));
  await screen.findByText('Hi, Test.');
  const registration=(api as jest.Mock).mock.calls.find(([path])=>path==='/api/customer/register');
  expect(JSON.parse(registration![1].body)).toEqual({firstName:user.firstName,lastName:user.lastName,email:user.email,phone:user.phone,password,client:'mobile'});
  expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  const [key,raw]=(SecureStore.setItemAsync as jest.Mock).mock.calls[0];
  expect(key).toBe(CUSTOMER_SESSION_KEY);
  expect(JSON.parse(raw)).toEqual({origin:API_URL,token});
  expect(raw).not.toContain(password);
  expect(raw).not.toContain(user.email);
});

test('native login obtains a mobile session and logout revokes it before clearing local storage',async()=>{
  await render(<CustomerProvider><Account/></CustomerProvider>);
  await fillLogin();
  await screen.findByText('Hi, Test.');
  const login=(api as jest.Mock).mock.calls.find(([path])=>path==='/api/customer/login');
  expect(JSON.parse(login![1].body)).toEqual({email:user.email,password,client:'mobile'});
  await fireEvent.press(screen.getByText('Sign out'));
  await screen.findByText('Welcome back.');
  expect(api).toHaveBeenCalledWith('/api/customer/logout',expect.objectContaining({method:'POST',headers:{Authorization:`Bearer ${token}`}}));
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(CUSTOMER_SESSION_KEY);
});

test('native startup restores a saved session using server-validated customer data',async()=>{
  savedSession();
  await render(<CustomerProvider><Account/></CustomerProvider>);
  await screen.findByText('Hi, Test.');
  expect(api).toHaveBeenCalledWith('/api/customer/session',{headers:{Authorization:`Bearer ${token}`}});
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  expect(screen.getByText(user.email)).toBeTruthy();
});

test('a saved session for a different API origin is discarded without sending its token',async()=>{
  savedSession('https://old-cwash.example.test');
  await render(<CustomerProvider><Account/></CustomerProvider>);
  await screen.findByText('Welcome back.');
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(CUSTOMER_SESSION_KEY);
  expect(api).not.toHaveBeenCalled();
  expect(screen.getByText('Sign in to your account on this server.')).toBeTruthy();
});

test('an expired account request clears the saved session without replaying the booking as a guest',async()=>{
  savedSession();
  (api as jest.Mock).mockImplementation(async(path:string)=>{
    if(path==='/api/customer/session')return {authenticated:true,user};
    throw new ApiError('Please sign in again.',401);
  });
  await render(<CustomerProvider><Probe/></CustomerProvider>);
  await waitFor(()=>expect(screen.getByTestId('session-status').props.children).toBe('authenticated'));
  await fireEvent.press(screen.getByText('Send account request'));
  await waitFor(()=>expect(screen.getByTestId('session-status').props.children).toBe('guest'));
  expect(screen.getByTestId('request-error').props.children).toBe('Please sign in again.');
  const submissions=(api as jest.Mock).mock.calls.filter(([path])=>path==='/api/bookings');
  expect(submissions).toHaveLength(1);
  expect(submissions[0][1].headers.Authorization).toBe(`Bearer ${token}`);
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(CUSTOMER_SESSION_KEY);
});

test('secure-storage failure leaves the customer signed out and revokes the newly issued session',async()=>{
  (SecureStore.setItemAsync as jest.Mock).mockRejectedValue(new Error('Keychain unavailable'));
  await render(<CustomerProvider><Account/><Probe/></CustomerProvider>);
  await fillLogin();
  await screen.findByText(/Your account session could not be saved securely/);
  expect(screen.getByTestId('session-status').props.children).toBe('guest');
  expect(screen.queryByText('Hi, Test.')).toBeNull();
  expect(api).toHaveBeenCalledWith('/api/customer/logout',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:'{}'});
});

test('account history loads server-owned bookings without showing local guest receipts',async()=>{
  savedSession();
  await render(<CustomerProvider><Bookings/></CustomerProvider>);
  await screen.findByText(receipt.reference);
  expect(screen.getByText('My bookings.')).toBeTruthy();
  expect(api).toHaveBeenCalledWith('/api/customer/bookings',expect.objectContaining({headers:{Authorization:`Bearer ${token}`}}));
  expect(loadReceipts).not.toHaveBeenCalled();
  expect(refreshReceipt).not.toHaveBeenCalled();
  expect(screen.queryByText(guestReceipt.reference)).toBeNull();
});

test('guest history refreshes only this phone’s saved receipts and offers account sign-in',async()=>{
  await render(<CustomerProvider><Bookings/></CustomerProvider>);
  await screen.findByText(guestReceipt.reference);
  await screen.findByText('CONFIRMED');
  expect(screen.getByText('Guest requests.')).toBeTruthy();
  expect(screen.getByText('Sign in to see account bookings')).toBeTruthy();
  expect(loadReceipts).toHaveBeenCalledTimes(1);
  expect(refreshReceipt).toHaveBeenCalledWith(guestReceipt,0,[guestReceipt]);
  expect(api).not.toHaveBeenCalled();
  expect(screen.queryByText(receipt.reference)).toBeNull();
});

test('failed startup validation blocks account actions until the connection is restored',async()=>{
  savedSession();
  (api as jest.Mock).mockRejectedValue(new Error('Network unavailable'));
  await render(<CustomerProvider><Account/><Probe/></CustomerProvider>);
  await screen.findByText('Let’s reconnect.');
  await fireEvent.press(screen.getByText('Send account request'));
  await waitFor(()=>expect(screen.getByTestId('request-error').props.children).toBe('Please reconnect your account before continuing.'));
  expect(screen.getByTestId('session-status').props.children).toBe('error');
  expect(api).toHaveBeenCalledTimes(1);
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
});
