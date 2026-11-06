import { useCallback, useRef, useState } from 'react';
import { AppState, RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { dateLabel, dollars, Receipt, timeLabel } from '../lib/api';
import { useCustomer } from '../lib/customer';
import { Billing, openStripeUrl, paymentLabel } from '../lib/billing';
import { loadReceipts, refreshReceipt } from '../lib/receipts';
import { Button, ErrorNotice, Loading, Screen, s, Title } from '../components/ui';

export default function Bookings(){
  const auth=useCustomer();
  if(auth.status==='loading')return <Screen><Loading/></Screen>;
  if(auth.status==='error')return <Screen><ErrorNotice message={auth.notice}/><Button label="Retry connection" onPress={auth.retry}/></Screen>;
  return <BookingHistory key={auth.user?.id||'guest'} signedIn={!!auth.user}/>;
}

function BookingHistory({signedIn}:{signedIn:boolean}){
  const {request}=useCustomer();
  const [receipts,setReceipts]=useState<Receipt[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [billing,setBilling]=useState<Billing|null>(null),[paying,setPaying]=useState(''),[notice,setNotice]=useState('');
  const generation=useRef(0),payingRef=useRef(false),active=useRef(false);
  const load=useCallback(async()=>{
    const version=++generation.current;
    setLoading(true);setError('');
    try{
      if(signedIn){
        const [bookingsResult,billingResult]=await Promise.allSettled([
          request<{bookings:Receipt[]}>('/api/customer/bookings'),
          request<Billing>('/api/customer/billing'),
        ]);
        if(version!==generation.current)return;
        if(bookingsResult.status==='rejected')throw bookingsResult.reason;
        setReceipts(bookingsResult.value.bookings);
        if(billingResult.status==='fulfilled')setBilling(billingResult.value);
        else{setBilling(null);setError('Your bookings loaded, but payment status could not refresh. Please try again before paying.');}
      }else{
        const saved=await loadReceipts();
        if(version!==generation.current)return;
        setReceipts(saved);
        const results=await Promise.allSettled(saved.map(refreshReceipt));
        if(version!==generation.current)return;
        setReceipts(results.map((r,i)=>r.status==='fulfilled'?r.value:saved[i]));
        if(results.some(r=>r.status==='rejected'))setError('Some guest requests could not refresh. Showing their last saved status. Pull down to try again.');
      }
    }catch(e){if(version===generation.current)setError((e as Error).message||'Could not load your bookings.');}
    finally{if(version===generation.current)setLoading(false);}
  },[signedIn,request]);
  useFocusEffect(useCallback(()=>{
    active.current=true;void load();
    const subscription=AppState.addEventListener('change',state=>{if(state==='active')void load();});
    return()=>{active.current=false;generation.current++;subscription.remove();};
  },[load]));
  async function pay(reference:string){
    if(payingRef.current)return;
    payingRef.current=true;setPaying(reference);setError('');setNotice('');
    try{
      const result=await request<{url:string}>(`/api/customer/bookings/${encodeURIComponent(reference)}/checkout`,{method:'POST',body:'{}'});
      if(!active.current)return;
      await openStripeUrl(result.url);
      if(active.current)setNotice('Return to CWASH after checkout and refresh. Your payment stays unconfirmed until Stripe confirms it.');
    }catch(e){if(active.current)setError((e as Error).message);}
    finally{payingRef.current=false;setPaying('');}
  }
  return <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={load}/>}>
    <Title eyebrow="YOUR NEXT FRESH START" description={signedIn?'Your account bookings, available on the website and app. Pull down for the latest status.':'Guest requests saved on this phone. Pull down to check the latest status.'}>{signedIn?'My bookings.':'Guest requests.'}</Title>
    {!signedIn&&<Button label="Sign in to see account bookings" secondary onPress={()=>router.navigate('/account')}/>}
    {!!notice&&<Text accessibilityLiveRegion="polite" style={s.body}>{notice}</Text>}
    {billing?.mode==='test'&&<Text style={s.small}>TEST MODE · NO REAL CHARGES</Text>}
    <ErrorNotice message={error}/>{!!error&&<Button label="Retry" secondary onPress={load}/>}
    {loading&&!receipts.length&&<Loading/>}
    {!loading&&!error&&!receipts.length&&<View style={s.card}><Text style={s.cardTitle}>Your next detail starts here.</Text><Text style={s.body}>Once you book, you can follow your request here.</Text><Button label="Book a detail" onPress={()=>router.navigate('/book')}/></View>}
    {receipts.map(receipt=>{
      const payment=billing?.payments.find(item=>item.reference===receipt.reference);
      const canPay=signedIn&&billing?.enabled&&receipt.status==='confirmed'&&receipt.coverage!=='membership'&&!receipt.membershipIncluded&&(!payment||payment.status==='pending');
      return <View key={receipt.reference} style={s.card}><View style={s.badge}><Text style={s.badgeText}>{receipt.status==='pending'?'AWAITING CONFIRMATION':receipt.status.toUpperCase()}</Text></View><Text style={s.cardTitle}>{receipt.serviceName}</Text><Text style={s.body}>{receipt.vehicleName}</Text><Text style={s.body}>{dateLabel(receipt.date)} · {timeLabel(receipt.time)}{'\n'}New York time</Text><View style={s.row}><Text style={s.small}>{receipt.reference}</Text><Text style={s.cardTitle}>{dollars(receipt.total)}</Text></View>
        {(receipt.coverage==='membership'||receipt.membershipIncluded)&&<Text style={s.body}>Included with membership</Text>}
        {payment&&<Text style={s.body}>{paymentLabel(payment.status)}</Text>}
        {canPay&&<><Button label={paying===receipt.reference?'Opening Stripe…':payment?.status==='pending'?'Continue payment':'Pay now'} disabled={!!paying||loading||!!error} onPress={()=>pay(receipt.reference)}/>{billing?.membership&&!['canceled','incomplete_expired'].includes(billing.membership.status)&&<Text style={s.small}>This is a separate paid service. Included visits are booked through Membership & billing.</Text>}</>}
        {signedIn&&receipt.status==='pending'&&receipt.coverage!=='membership'&&!receipt.membershipIncluded&&<Text style={s.small}>Online payment becomes available after CWASH confirms your request.</Text>}
      </View>;
    })}
    <Text style={s.small}>{signedIn?'Bookings made while signed in appear here. Earlier guest requests stay separate.':'Guest requests belong to this installation; reinstalling or clearing app data may remove access. Sign in before booking to save future requests to your account.'} No automatic push or email notifications yet. Check here for updates.</Text>
  </Screen>;
}
