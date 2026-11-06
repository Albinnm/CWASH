import React from 'react';
import { AppState } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import BillingScreen from '../src/app/billing';
import Bookings from '../src/app/bookings';
import { api, API_URL } from '../src/lib/api';
import { Billing, safeStripeUrl } from '../src/lib/billing';
import { CustomerProvider } from '../src/lib/customer';

jest.mock('expo-router',()=>({router:{navigate:jest.fn()},useFocusEffect(effect:()=>void|(()=>void)){jest.requireActual('react').useEffect(effect,[effect]);}}));
jest.mock('expo-linking',()=>({openURL:jest.fn()}));
jest.mock('react-native-safe-area-context',()=>jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-secure-store',()=>({getItemAsync:jest.fn(),setItemAsync:jest.fn(),deleteItemAsync:jest.fn()}));
jest.mock('../src/lib/api',()=>({...jest.requireActual('../src/lib/api'),API_URL:'https://cwash.example.test',api:jest.fn()}));
const user={id:'billing-customer',firstName:'Billing',lastName:'Customer',email:'billing@example.test',phone:'2125550100'};
const plan={name:'Car care membership',description:'Your configured service plan.',amount:19900,currency:'usd' as const,interval:'month' as const};
const initial:Billing={enabled:true,mode:'test',plan,membership:null,canManage:false,payments:[]};
let billing:Billing;
let checkoutUrl:string;
const receipt={reference:'CW-CONFIRMED',status:'confirmed',serviceName:'Full detail',vehicleName:'Sedan',date:'2026-11-10',time:'09:00',total:199,duration:180};
beforeEach(()=>{
  jest.clearAllMocks();jest.spyOn(AppState,'addEventListener').mockReturnValue({remove:jest.fn()});billing={...initial};checkoutUrl='https://checkout.stripe.com/c/pay/test_checkout';
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify({origin:API_URL,token:'a'.repeat(64)}));
  (Linking.openURL as jest.Mock).mockResolvedValue(true);
  (api as jest.Mock).mockImplementation(async(path:string)=>{
    if(path==='/api/customer/session')return {authenticated:true,user};
    if(path==='/api/customer/billing')return billing;
    if(path.endsWith('/checkout'))return {url:checkoutUrl};
    if(path.endsWith('/portal'))return {url:'https://billing.stripe.com/p/session/test_portal'};
    if(path==='/api/customer/bookings')return {bookings:[receipt,{...receipt,reference:'CW-PENDING',status:'pending'},{...receipt,reference:'CW-INCLUDED',coverage:'membership',total:0},{...receipt,reference:'CW-CANCELLED',status:'cancelled'}]};
    throw new Error(`Unexpected API request: ${path}`);
  });
});

test('disabled billing has no purchasable placeholder plan',async()=>{
  billing={enabled:false,mode:null,plan:null,membership:null,canManage:false,payments:[]};
  await render(<CustomerProvider><BillingScreen/></CustomerProvider>);
  await screen.findByText('Online payments are coming soon.');
  expect(screen.queryByText('Continue to membership checkout')).toBeNull();
  expect(screen.queryByText('Manage billing')).toBeNull();
  expect(Linking.openURL).not.toHaveBeenCalled();
});

test('membership checkout requires recurring-payment consent and does not claim payment on browser return',async()=>{
  await render(<CustomerProvider><BillingScreen/></CustomerProvider>);
  await screen.findByText(plan.name);
  await fireEvent.press(screen.getByText('Continue to membership checkout'));
  expect((api as jest.Mock).mock.calls.filter(([path])=>path.endsWith('/checkout'))).toHaveLength(0);
  await fireEvent.press(screen.getByRole('checkbox',{name:'Agree to monthly membership renewal'}));
  await fireEvent.press(screen.getByText('Continue to membership checkout'));
  await screen.findByText(/Return to CWASH after checkout or billing changes/);
  expect(Linking.openURL).toHaveBeenCalledWith(checkoutUrl);
  expect(screen.queryByText('Active')).toBeNull();
  expect(api).toHaveBeenCalledWith('/api/customer/membership/checkout',expect.objectContaining({body:'{}',headers:{Authorization:`Bearer ${'a'.repeat(64)}`}}));
});

test('untrusted checkout URL is never opened',async()=>{
  checkoutUrl='https://checkout.stripe.com.attacker.example/pay';
  await render(<CustomerProvider><BillingScreen/></CustomerProvider>);
  await screen.findByText(plan.name);
  await fireEvent.press(screen.getByRole('checkbox',{name:'Agree to monthly membership renewal'}));
  await fireEvent.press(screen.getByText('Continue to membership checkout'));
  await screen.findByText('The payment link is not a trusted Stripe address. Please try again.');
  expect(Linking.openURL).not.toHaveBeenCalled();
});

test('Stripe URL validation rejects insecure, credential-bearing, and unexpected-port links',()=>{
  for(const url of ['http://checkout.stripe.com/pay','https://stripe.com/pay','https://checkout.stripe.com@evil.example/pay','https://user@billing.stripe.com/pay','https://checkout.stripe.com:444/pay','javascript:alert(1)'])expect(()=>safeStripeUrl(url)).toThrow();
  expect(safeStripeUrl('https://billing.stripe.com/p/session/test')).toBe('https://billing.stripe.com/p/session/test');
});

test('confirmed separately billed booking can pay but pending, included, and cancelled visits cannot',async()=>{
  await render(<CustomerProvider><Bookings/></CustomerProvider>);
  await screen.findByText('CW-CONFIRMED');
  expect(screen.getAllByText('Pay now')).toHaveLength(1);
  expect(screen.getByText('Included with membership')).toBeTruthy();
  await fireEvent.press(screen.getByText('Pay now'));
  await screen.findByText(/Return to CWASH after checkout and refresh/);
  expect(api).toHaveBeenCalledWith('/api/customer/bookings/CW-CONFIRMED/checkout',expect.objectContaining({body:'{}'}));
  expect(screen.queryByText('Paid')).toBeNull();
});

test('server-confirmed paid and refunded bookings never offer another payment',async()=>{
  billing={...billing,payments:[{reference:receipt.reference,status:'paid',amount:19900,currency:'usd'}]};
  await render(<CustomerProvider><Bookings/></CustomerProvider>);
  await screen.findByText('Paid');
  expect(screen.queryByText('Pay now')).toBeNull();
  expect(screen.queryByText('Continue payment')).toBeNull();
});

test('membership and payment status update only after a fresh server response',async()=>{
  await render(<CustomerProvider><BillingScreen/></CustomerProvider>);
  await screen.findByText(plan.name);
  billing={...billing,membership:{status:'active',cancelAtPeriodEnd:false,currentPeriodEnd:1900000000},canManage:true,payments:[{reference:receipt.reference,status:'paid',amount:19900,currency:'usd'}]};
  await fireEvent.press(screen.getByText('Refresh billing'));
  await screen.findByText('Active');
  expect(screen.getByText('Paid · $199.00')).toBeTruthy();
  expect(screen.queryByText('Continue to membership checkout')).toBeNull();
  await fireEvent.press(screen.getByText('Manage billing'));
  await screen.findByText(/Return to CWASH after checkout or billing changes/);
  expect(Linking.openURL).toHaveBeenCalledWith('https://billing.stripe.com/p/session/test_portal');
});

test('eligible membership visit routes explicitly into covered booking mode',async()=>{
  billing={...billing,membership:{status:'active',cancelAtPeriodEnd:false,currentPeriodEnd:1900000000},benefits:{active:true,fullDetailAvailable:true,periodEnd:1900000000}};
  await render(<CustomerProvider><BillingScreen/></CustomerProvider>);
  await fireEvent.press(await screen.findByText('Book included full detail'));
  expect(router.navigate).toHaveBeenCalledWith({pathname:'/book',params:expect.objectContaining({coverage:'membership',service:'full'})});
  expect(screen.queryByText('Book weekly maintenance')).toBeNull();
});


test('maintenance navigation is offered only when the server makes it available',async()=>{
  billing={...billing,membership:{status:'active',cancelAtPeriodEnd:false,currentPeriodEnd:1900000000},benefits:{active:true,fullDetailAvailable:false,maintenanceAvailable:true,periodEnd:1900000000}};
  await render(<CustomerProvider><BillingScreen/></CustomerProvider>);
  await fireEvent.press(await screen.findByText('Book weekly maintenance'));
  expect(router.navigate).toHaveBeenCalledWith({pathname:'/book',params:expect.objectContaining({coverage:'membership',service:'maintenance'})});
  expect(screen.queryByText('Book included full detail')).toBeNull();
});
