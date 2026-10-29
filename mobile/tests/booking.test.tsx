import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Book from '../src/app/book';
import { api } from '../src/lib/api';
import { saveReceipt } from '../src/lib/receipts';

jest.mock('expo-router',()=>({useLocalSearchParams:()=>({}),router:{navigate:jest.fn()}}));
jest.mock('react-native-safe-area-context',()=>jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('../src/lib/api',()=>({...jest.requireActual('../src/lib/api'),api:jest.fn()}));
jest.mock('../src/lib/receipts',()=>({saveReceipt:jest.fn()}));
const catalog={services:[{id:'full',name:'Full detail',price:199,duration:180,features:[],description:'Inside and out'}],vehicles:[{id:'sedan',name:'Sedan',surcharge:0,durationExtra:0}],settings:{preview:true,zipPrefixes:['112']}};
const booking={reference:'CW-TEST123',status:'pending',serviceName:'Full detail',vehicleName:'Sedan',date:'2026-11-10',time:'09:00',total:199,duration:180,accessToken:'test-only-key'};
beforeEach(()=>{(api as jest.Mock).mockImplementation((path:string)=>Promise.resolve(path==='/api/catalog'?catalog:path.startsWith('/api/availability')?{slots:['09:00']}:{booking}));(saveReceipt as jest.Mock).mockResolvedValue(undefined);});

async function goToContact(){
  await render(<Book/>);
  await screen.findByText('Full detail');
  await fireEvent.press(screen.getByText('Full detail'));
  await fireEvent.press(screen.getByText('Sedan'));
  await fireEvent.press(screen.getByText('Continue →'));
  await fireEvent.changeText(screen.getByLabelText('NYC ZIP code'),'11201');
  await fireEvent.changeText(screen.getByLabelText('Street address'),'123 Test Street');
  await fireEvent.press(screen.getByText('Private driveway'));
  await fireEvent.press(screen.getByText('Continue →'));
  await fireEvent.press(await screen.findByText('9:00 AM'));
  await fireEvent.press(screen.getByText('Continue →'));
  await fireEvent.changeText(screen.getByLabelText('First name'),'Test');
  await fireEvent.changeText(screen.getByLabelText('Last name'),'Customer');
  await fireEvent.changeText(screen.getByLabelText('Email'),'test@example.test');
  await fireEvent.changeText(screen.getByLabelText('Phone number'),'2125550100');
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
