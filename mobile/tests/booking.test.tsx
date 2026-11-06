import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Book from '../src/app/book';
import { api } from '../src/lib/api';
import { saveReceipt } from '../src/lib/receipts';
import { useCustomer } from '../src/lib/customer';
import { useLocalSearchParams } from 'expo-router';

jest.mock('expo-router',()=>({useLocalSearchParams:jest.fn(),router:{navigate:jest.fn()}}));
jest.mock('react-native-safe-area-context',()=>jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('../src/lib/api',()=>({...jest.requireActual('../src/lib/api'),api:jest.fn()}));
jest.mock('../src/lib/receipts',()=>({saveReceipt:jest.fn()}));
jest.mock('../src/lib/customer',()=>({useCustomer:jest.fn()}));
const catalog={services:[{id:'full',name:'Full detail',price:199,duration:180,features:[],description:'Inside and out'}],vehicles:[{id:'sedan',name:'Sedan',surcharge:0,durationExtra:0}],settings:{preview:true,zipPrefixes:['112']}};
const booking={reference:'CW-TEST123',status:'pending',serviceName:'Full detail',vehicleName:'Sedan',date:'2026-11-10',time:'09:00',total:199,duration:180,accessToken:'test-only-key'};
beforeEach(()=>{jest.clearAllMocks();(useLocalSearchParams as jest.Mock).mockReturnValue({});(useCustomer as jest.Mock).mockReturnValue({status:'guest',user:null,request:api});(api as jest.Mock).mockImplementation((path:string)=>Promise.resolve(path==='/api/catalog'?catalog:path.startsWith('/api/availability')?{slots:['09:00']}:{booking}));(saveReceipt as jest.Mock).mockResolvedValue(undefined);});

async function goToContact(guest=true,serviceName='Full detail'){
  await render(<Book/>);
  await screen.findByText(serviceName);
  await fireEvent.press(screen.getByText(serviceName));
  await fireEvent.press(screen.getByText('Sedan'));
  await fireEvent.press(screen.getByText('Continue →'));
  await fireEvent.changeText(screen.getByLabelText('NYC ZIP code'),'11201');
  await fireEvent.changeText(screen.getByLabelText('Street address'),'123 Test Street');
  await fireEvent.press(screen.getByText('Private driveway'));
  await fireEvent.press(screen.getByText('Continue →'));
  await fireEvent.press(await screen.findByText('9:00 AM'));
  await fireEvent.press(screen.getByText('Continue →'));
  if(guest){
  await fireEvent.changeText(screen.getByLabelText('First name'),'Test');
  await fireEvent.changeText(screen.getByLabelText('Last name'),'Customer');
  await fireEvent.changeText(screen.getByLabelText('Email'),'test@example.test');
  await fireEvent.changeText(screen.getByLabelText('Phone number'),'2125550100');
  }
  await fireEvent.press(screen.getByRole('checkbox'));
}
test('native booking submits the chosen service and saves its private receipt',async()=>{
  await goToContact();
  await fireEvent.press(screen.getByText('Request appointment'));
  await screen.findByText('CW-TEST123');
  await waitFor(()=>expect(saveReceipt).toHaveBeenCalledWith(booking));
  const call=(api as jest.Mock).mock.calls.find(([path])=>path==='/api/bookings');
  expect(JSON.parse(call![1].body)).toMatchObject({serviceId:'full',vehicleId:'sedan',zip:'11201',time:'09:00',consent:true});
});
test('successful booking remains successful when secure storage fails',async()=>{
  (saveReceipt as jest.Mock).mockRejectedValue(new Error('Storage full'));
  await goToContact();
  await fireEvent.press(screen.getByText('Request appointment'));
  await screen.findByText(/Your booking was submitted, but could not be saved/);
  expect(screen.getByText('CW-TEST123')).toBeTruthy();
  expect(screen.queryByText('Request appointment')).toBeNull();
  expect((api as jest.Mock).mock.calls.filter(([path])=>path==='/api/bookings')).toHaveLength(1);
});
test('missing selections cannot advance the native booking flow',async()=>{
  await render(<Book/>);await screen.findByText('Full detail');
  await fireEvent.press(screen.getByText('Continue →'));
  expect(screen.getByText('Choose your service and vehicle size.')).toBeTruthy();
  expect(screen.queryByLabelText('Street address')).toBeNull();
});

test('signed-in booking prefills contact details and leaves private history on the server',async()=>{
  (useCustomer as jest.Mock).mockReturnValue({status:'authenticated',user:{id:'customer-1',firstName:'Account',lastName:'Customer',email:'account@example.test',phone:'2125550100'},request:api});
  await goToContact(false);
  expect(screen.getByLabelText('First name').props.value).toBe('Account');
  expect(screen.getByLabelText('Email').props.value).toBe('account@example.test');
  expect(screen.getByLabelText('Email').props.editable).toBe(false);
  await fireEvent.press(screen.getByText('Request appointment'));
  await screen.findByText('CW-TEST123');
  expect(saveReceipt).not.toHaveBeenCalled();
  const call=(api as jest.Mock).mock.calls.find(([path])=>path==='/api/bookings');
  expect(JSON.parse(call![1].body)).toMatchObject({firstName:'Account',email:'account@example.test'});
});


test('included full-detail booking submits explicit membership coverage with no separate price',async()=>{
  (useLocalSearchParams as jest.Mock).mockReturnValue({coverage:'membership',service:'full'});
  (useCustomer as jest.Mock).mockReturnValue({status:'authenticated',user:{id:'customer-1',firstName:'Member',lastName:'Customer',email:'member@example.test',phone:'2125550100'},request:api});
  (api as jest.Mock).mockImplementation((path:string)=>Promise.resolve(path==='/api/catalog'?catalog:path==='/api/customer/billing'?{benefits:{active:true,fullDetailAvailable:true,periodEnd:1900000000}}:path.startsWith('/api/availability')?{slots:['09:00']}:{booking:{...booking,coverage:'membership',total:0,accessToken:undefined}}));
  await goToContact(false);
  expect(screen.getAllByText('Included with membership').length).toBeGreaterThan(0);
  await fireEvent.press(screen.getByText('Request appointment'));
  await screen.findByText('CW-TEST123');
  const call=(api as jest.Mock).mock.calls.find(([path])=>path==='/api/bookings');
  expect(JSON.parse(call![1].body)).toMatchObject({coverage:'membership',serviceId:'full'});
  expect((api as jest.Mock).mock.calls.some(([path])=>path.startsWith('/api/availability')&&path.includes('coverage=membership'))).toBe(true);
  expect(saveReceipt).not.toHaveBeenCalled();
});

test('inactive memberships cannot enter the included booking flow',async()=>{
  (useLocalSearchParams as jest.Mock).mockReturnValue({coverage:'membership',service:'full'});
  (useCustomer as jest.Mock).mockReturnValue({status:'authenticated',user:{id:'customer-1',firstName:'Member',lastName:'Customer',email:'member@example.test',phone:'2125550100'},request:api});
  (api as jest.Mock).mockImplementation((path:string)=>Promise.resolve(path==='/api/catalog'?catalog:{benefits:{active:false,fullDetailAvailable:true,periodEnd:null}}));
  await render(<Book/>);
  await screen.findByText(/An active paid membership is required/);
  expect(screen.queryByText('Continue →')).toBeNull();
});


test('included maintenance uses its membership service and skips a separate payment',async()=>{
  (useLocalSearchParams as jest.Mock).mockReturnValue({coverage:'membership',service:'maintenance'});
  (useCustomer as jest.Mock).mockReturnValue({status:'authenticated',user:{id:'customer-1',firstName:'Member',lastName:'Customer',email:'member@example.test',phone:'2125550100'},request:api});
  const membershipService={id:'maintenance',name:'Weekly maintenance',price:0,duration:60,features:[],description:'Routine upkeep'};
  (api as jest.Mock).mockImplementation((path:string)=>Promise.resolve(path==='/api/catalog'?{...catalog,membershipService}:path==='/api/customer/billing'?{benefits:{active:true,fullDetailAvailable:false,maintenanceAvailable:true,periodEnd:1900000000}}:path.startsWith('/api/availability')?{slots:['09:00']}:{booking:{...booking,serviceName:'Weekly maintenance',coverage:'membership',membershipIncluded:true,total:0,accessToken:undefined}}));
  await goToContact(false,'Weekly maintenance');
  await fireEvent.press(screen.getByText('Request appointment'));
  await screen.findByText('CW-TEST123');
  const call=(api as jest.Mock).mock.calls.find(([path])=>path==='/api/bookings');
  expect(JSON.parse(call![1].body)).toMatchObject({coverage:'membership',serviceId:'maintenance'});
  expect(JSON.parse(call![1].body)).not.toHaveProperty('total');
  expect(screen.getByText('Back to membership')).toBeTruthy();
  expect(screen.queryByText('Request another detail')).toBeNull();
  expect(saveReceipt).not.toHaveBeenCalled();
});

test('changed membership allowance cannot submit a second introductory detail',async()=>{
  (useLocalSearchParams as jest.Mock).mockReturnValue({coverage:'membership',service:'full'});
  (useCustomer as jest.Mock).mockReturnValue({status:'authenticated',user:{id:'customer-1'},request:api});
  (api as jest.Mock).mockImplementation((path:string)=>Promise.resolve(path==='/api/catalog'?catalog:{benefits:{active:true,fullDetailAvailable:false,maintenanceAvailable:true,periodEnd:1900000000}}));
  await render(<Book/>);
  await screen.findByText(/Your included visit availability changed/);
  expect(screen.queryByText('Continue →')).toBeNull();
  expect((api as jest.Mock).mock.calls.some(([path])=>path==='/api/bookings')).toBe(false);
});
