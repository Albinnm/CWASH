import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api, Catalog, dateLabel, dollars, nyDate, Receipt, timeLabel } from '../lib/api';
import { saveReceipt } from '../lib/receipts';
import { Button, Choice, ErrorNotice, Field, Loading, Screen, s, Title } from '../components/ui';

const empty = ()=>({serviceId:'',vehicleId:'',date:nyDate(new Date(Date.now()+86400000)),time:'',firstName:'',lastName:'',email:'',phone:'',address:'',unit:'',zip:'',parking:'',notes:'',consent:false});
type Form=ReturnType<typeof empty>;
export default function Book(){
  const params=useLocalSearchParams<{service?:string;selection?:string}>();
  return <BookingForm key={`${params.service||'default'}-${params.selection||''}`} initialService={params.service}/>;
}
function BookingForm({initialService}:{initialService?:string}){
  const [catalog,setCatalog]=useState<Catalog|null>(null),[form,setForm]=useState(()=>({...empty(),serviceId:initialService||''})),[step,setStep]=useState(0),[offset,setOffset]=useState(0);
  const [error,setError]=useState(''),[sending,setSending]=useState(false),[receipt,setReceipt]=useState<Receipt|null>(null),[storageError,setStorageError]=useState('');
  const sendingRef=useRef(false);
  const [calendarStart]=useState(()=>Date.now());
  const [slotState,setSlotState]=useState({key:'',slots:[] as string[],error:''});
  const queryKey=`${form.date}|${form.serviceId}|${form.vehicleId}`;
  const loadingSlots=step===2&&slotState.key!==queryKey;
  const slots=slotState.key===queryKey?slotState.slots:[];
  const slotError=slotState.key===queryKey?slotState.error:'';
  async function load(){setError('');try{setCatalog(await api<Catalog>('/api/catalog'));}catch(e){setError((e as Error).message);}}
  useEffect(()=>{let active=true;api<Catalog>('/api/catalog').then(data=>{if(active)setCatalog(data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  useEffect(()=>{
    if(step!==2||!form.serviceId||!form.vehicleId)return;
    let active=true;
    const query=new URLSearchParams({date:form.date,serviceId:form.serviceId,vehicleId:form.vehicleId});
    api<{slots:string[]}>(`/api/availability?${query}`).then(data=>{if(active)setSlotState({key:queryKey,slots:data.slots,error:''});}).catch(e=>{if(active)setSlotState({key:queryKey,slots:[],error:e.message});});
    return ()=>{active=false;};
  },[step,form.date,form.serviceId,form.vehicleId,queryKey]);
  function update<K extends keyof Form>(key:K,value:Form[K]){setForm(f=>({...f,[key]:value,...(['serviceId','vehicleId','date'].includes(key)?{time:''}:{})}));setError('');}
  const service=catalog?.services.find(item=>item.id===form.serviceId),vehicle=catalog?.vehicles.find(item=>item.id===form.vehicleId);
  const total=(service?.price||0)+(vehicle?.surcharge||0),duration=(service?.duration||0)+(vehicle?.durationExtra||0);
  async function next(){
    setError('');
    if(step===0&&(!service||!vehicle)){setError('Choose your service and vehicle size.');return;}
    if(step===1){
      if(!/^\d{5}$/.test(form.zip)||!catalog?.settings.zipPrefixes.some(prefix=>form.zip.startsWith(prefix))){setError('Enter a supported five-digit NYC ZIP code.');return;}
      if(!form.address.trim()||!form.parking){setError('Enter the address and select a parking type.');return;}
    }
    if(step===2&&(!form.time||!slots.includes(form.time))){setError('Choose an available appointment time.');return;}
    if(step<3){setStep(step+1);return;}
    if(!form.firstName.trim()||!form.lastName.trim()||!/^\S+@\S+\.\S+$/.test(form.email.trim())||form.phone.replace(/\D/g,'').length<10){setError('Enter your name, email, and a valid phone number.');return;}
    if(!form.consent){setError('Please acknowledge that this is a request awaiting confirmation.');return;}
    if(sendingRef.current)return;
    sendingRef.current=true;setSending(true);
    try{
      const {booking}=await api<{booking:Receipt}>('/api/bookings',{method:'POST',body:JSON.stringify({...form,email:form.email.trim()})});
      // Submission succeeded even if local secure storage fails. Never invite a duplicate request.
      setReceipt(booking);setStorageError('');
      try{await saveReceipt(booking);}catch{setStorageError('Your booking was submitted, but could not be saved on this phone. Save the reference shown here.');}
    }catch(e){setError((e as Error).message);}finally{setSending(false);sendingRef.current=false;}
  }
  function reset(){setReceipt(null);setForm(empty());setStep(0);setError('');setStorageError('');}
  if(receipt)return <Screen><Title eyebrow="REQUEST RECEIVED">You’re on our list.</Title><View style={s.card}><View style={s.badge}><Text style={s.badgeText}>AWAITING CONFIRMATION</Text></View><Text style={s.cardTitle}>{receipt.reference}</Text><Text style={s.body}>{receipt.serviceName} · {receipt.vehicleName}</Text><Text style={s.body}>{dateLabel(receipt.date)} at {timeLabel(receipt.time)}{ '\n'}New York time</Text><Text style={s.price}>{dollars(receipt.total)}</Text><Text style={s.body}>We’ll review your requested time and workspace before accepting your appointment. No payment has been taken.</Text></View><ErrorNotice message={storageError}/><Button label="View my requests" onPress={()=>router.navigate('/bookings')}/><Button label="Request another detail" secondary onPress={reset}/></Screen>;
  return <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}><Screen><Title eyebrow={`YOUR FRESH START · STEP ${step+1} OF 4`} description="Appointments are reviewed before confirmation.">{['Your detail.','Your doorstep.','Your moment.','Your details.'][step]}</Title><View style={[s.progress,{width:`${(step+1)*25}%`}]}/>{catalog?.settings.preview&&<Text style={s.small}>PREVIEW · Sample prices. Booking requests are for testing.</Text>}{!catalog?<><ErrorNotice message={error}/>{error?<Button label="Retry connection" onPress={load}/>:<Loading/>}</>:<>
    {step===0&&<><Text style={s.section}>Choose your service</Text>{catalog.services.map(item=><Choice key={item.id} title={item.name} detail={`${dollars(item.price)} · ${item.duration} min`} selected={item.id===form.serviceId} onPress={()=>update('serviceId',item.id)}/>)}<Text style={s.section}>Your vehicle</Text>{catalog.vehicles.map(item=><Choice key={item.id} title={item.name} detail={item.surcharge?`+${dollars(item.surcharge)}`:'Base price'} selected={item.id===form.vehicleId} onPress={()=>update('vehicleId',item.id)}/>)}</>}
    {step===1&&<><Field label="NYC ZIP code" value={form.zip} onChangeText={v=>update('zip',v)} keyboardType="number-pad" maxLength={5} autoComplete="postal-code"/><Field label="Street address" value={form.address} onChangeText={v=>update('address',v)} maxLength={200} autoComplete="street-address"/><Field label="Apartment / unit (optional)" value={form.unit} onChangeText={v=>update('unit',v)} maxLength={80}/><Text style={s.section}>Where will you park?</Text>{[['driveway','Private driveway'],['private-lot','Private parking lot'],['garage','Garage'],['street','Street parking']].map(([id,name])=><Choice key={id} title={name} selected={form.parking===id} onPress={()=>update('parking',id)}/>)}<Text style={s.small}>We’ll confirm parking permission, workspace, and water or power needs. Street locations need an access review.</Text><Field label="Access notes (optional)" value={form.notes} onChangeText={v=>update('notes',v)} multiline maxLength={2000}/></>}
    {step===2&&<><Text style={s.section}>Choose a date</Text><Text style={s.body}>All dates and times are in New York time.</Text><View style={s.wrap}>{Array.from({length:14},(_,i)=>offset+i).filter(i=>i<90).map(i=>{const date=nyDate(new Date(calendarStart+i*86400000));return <Pressable key={date} accessibilityRole="radio" accessibilityState={{checked:form.date===date}} accessibilityLabel={dateLabel(date)} style={[s.chip,form.date===date&&s.chipSelected]} onPress={()=>update('date',date)}><Text style={s.label}>{dateLabel(date)}</Text></Pressable>;})}</View><View style={s.row}><Button label="← Earlier" secondary disabled={offset===0} onPress={()=>setOffset(Math.max(0,offset-14))}/><Button label="Later →" secondary disabled={offset>=84} onPress={()=>setOffset(offset+14)}/></View><Text style={s.section}>Arrival time · {dateLabel(form.date)}</Text><ErrorNotice message={slotError}/>{loadingSlots?<Loading/>:slots.length?<View style={s.wrap}>{slots.map(time=><Pressable key={time} accessibilityRole="radio" accessibilityState={{checked:form.time===time}} style={[s.chip,form.time===time&&s.chipSelected]} onPress={()=>update('time',time)}><Text style={s.label}>{timeLabel(time)}</Text></Pressable>)}</View>:!slotError&&<Text style={s.body}>No times available. Please choose another date.</Text>}</>}
    {step===3&&<><View style={s.card}><Text style={s.cardTitle}>{service?.name}</Text><Text style={s.body}>{vehicle?.name} · {duration} minutes{ '\n'}{dateLabel(form.date)}, {timeLabel(form.time)} · New York{ '\n'}{form.address}, {form.zip}</Text><Text style={s.price}>{dollars(total)}</Text></View><Field label="First name" value={form.firstName} onChangeText={v=>update('firstName',v)} maxLength={80} autoComplete="given-name"/><Field label="Last name" value={form.lastName} onChangeText={v=>update('lastName',v)} maxLength={80} autoComplete="family-name"/><Field label="Email" value={form.email} onChangeText={v=>update('email',v)} keyboardType="email-address" autoCapitalize="none" autoComplete="email" maxLength={200}/><Field label="Phone number" value={form.phone} onChangeText={v=>update('phone',v)} keyboardType="phone-pad" autoComplete="tel" maxLength={30}/><Pressable accessibilityRole="checkbox" accessibilityState={{checked:form.consent}} onPress={()=>update('consent',!form.consent)} style={[s.card,form.consent&&s.selected]}><Text style={s.body}>{form.consent?'☑':'☐'} I understand this is a booking request awaiting confirmation. No payment is due now.</Text></Pressable></>}
    <ErrorNotice message={error}/>{service&&step!==3&&<Text style={s.cardTitle}>Estimated total · {dollars(total)}</Text>}<Button label={sending?'Submitting…':step===3?'Request appointment':'Continue →'} disabled={sending||(step===2&&loadingSlots)} onPress={next}/>{step>0&&<Button label="Back" secondary disabled={sending} onPress={()=>{setStep(step-1);setError('');}}/>}
  </>}</Screen></KeyboardAvoidingView>;
}
