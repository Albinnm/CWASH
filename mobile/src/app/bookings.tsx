import { useCallback, useRef, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { dateLabel, dollars, Receipt, timeLabel } from '../lib/api';
import { useCustomer } from '../lib/customer';
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
  const generation=useRef(0);
  const load=useCallback(async()=>{
    const version=++generation.current;
    setLoading(true);setError('');
    try{
      if(signedIn){
        const result=await request<{bookings:Receipt[]}>('/api/customer/bookings');
        if(version===generation.current)setReceipts(result.bookings);
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
  useFocusEffect(useCallback(()=>{void load();return()=>{generation.current++;};},[load]));
  return <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={load}/>}>
    <Title eyebrow="YOUR NEXT FRESH START" description={signedIn?'Your account bookings, available on the website and app. Pull down for the latest status.':'Guest requests saved on this phone. Pull down to check the latest status.'}>{signedIn?'My bookings.':'Guest requests.'}</Title>
    {!signedIn&&<Button label="Sign in to see account bookings" secondary onPress={()=>router.navigate('/account')}/>}
    <ErrorNotice message={error}/>{!!error&&<Button label="Retry" secondary onPress={load}/>}
    {loading&&!receipts.length&&<Loading/>}
    {!loading&&!error&&!receipts.length&&<View style={s.card}><Text style={s.cardTitle}>Your next detail starts here.</Text><Text style={s.body}>Once you book, you can follow your request here.</Text><Button label="Book a detail" onPress={()=>router.navigate('/book')}/></View>}
    {receipts.map(receipt=><View key={receipt.reference} style={s.card}><View style={s.badge}><Text style={s.badgeText}>{receipt.status==='pending'?'AWAITING CONFIRMATION':receipt.status.toUpperCase()}</Text></View><Text style={s.cardTitle}>{receipt.serviceName}</Text><Text style={s.body}>{receipt.vehicleName}</Text><Text style={s.body}>{dateLabel(receipt.date)} · {timeLabel(receipt.time)}{'\n'}New York time</Text><View style={s.row}><Text style={s.small}>{receipt.reference}</Text><Text style={s.cardTitle}>{dollars(receipt.total)}</Text></View></View>)}
    <Text style={s.small}>{signedIn?'Bookings made while signed in appear here. Earlier guest requests stay separate.':'Guest requests belong to this installation; reinstalling or clearing app data may remove access. Sign in before booking to save future requests to your account.'} No automatic push or email notifications yet. Check here for updates.</Text>
  </Screen>;
}
