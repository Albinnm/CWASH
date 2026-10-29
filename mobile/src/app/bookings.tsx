import { useCallback, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { dateLabel, dollars, Receipt, timeLabel } from '../lib/api';
import { loadReceipts, refreshReceipt } from '../lib/receipts';
import { Button, ErrorNotice, Loading, Screen, s, Title } from '../components/ui';

export default function Bookings(){
  const [receipts,setReceipts]=useState<Receipt[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const load=useCallback(async()=>{setLoading(true);setError('');try{const saved=await loadReceipts();setReceipts(saved);const results=await Promise.allSettled(saved.map(refreshReceipt));setReceipts(results.map((r,i)=>r.status==='fulfilled'?r.value:saved[i]));if(results.some(r=>r.status==='rejected'))setError('Some requests could not refresh. Showing their last saved status. Pull down to try again.');}catch{setError('Could not read saved requests on this device.');}finally{setLoading(false);}},[]);
  useFocusEffect(useCallback(()=>{void load();},[load]));
  return <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={load}/>}><Title eyebrow="YOUR NEXT FRESH START" description="Requests saved on this phone. Pull down to check the latest status.">My requests.</Title><ErrorNotice message={error}/>{loading&&!receipts.length&&<Loading/>}{!loading&&!receipts.length&&<View style={s.card}><Text style={s.cardTitle}>Your next detail starts here.</Text><Text style={s.body}>Once you book, you can follow your request here.</Text><Button label="Book a detail" onPress={()=>router.navigate('/book')}/></View>}{receipts.map(receipt=><View key={receipt.reference} style={s.card}><View style={s.badge}><Text style={s.badgeText}>{receipt.status==='pending'?'AWAITING CONFIRMATION':receipt.status.toUpperCase()}</Text></View><Text style={s.cardTitle}>{receipt.serviceName}</Text><Text style={s.body}>{receipt.vehicleName}</Text><Text style={s.body}>{dateLabel(receipt.date)} · {timeLabel(receipt.time)}{ '\n'}New York time</Text><View style={s.row}><Text style={s.small}>{receipt.reference}</Text><Text style={s.cardTitle}>{dollars(receipt.total)}</Text></View></View>)}<Text style={s.small}>No automatic push or email notifications yet. Check here for updates. Requests are tied to this installation; reinstalling or clearing app data may remove access. Existing website bookings are not imported.</Text></Screen>;
}
