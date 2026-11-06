import { useCallback, useRef, useState } from 'react';
import { AppState, Pressable, RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useCustomer } from '../lib/customer';
import { Billing, billingAmount, membershipLabel, openStripeUrl, paymentLabel } from '../lib/billing';
import { Button, ErrorNotice, Loading, Screen, s, Title } from '../components/ui';

export default function BillingScreen(){
  const auth=useCustomer();
  if(auth.status==='loading')return <Screen><Loading/></Screen>;
  if(auth.status==='error')return <Screen><ErrorNotice message={auth.notice}/><Button label="Retry connection" onPress={auth.retry}/></Screen>;
  if(!auth.user)return <Screen><Title eyebrow="YOUR CAR CARE MEMBERSHIP">Membership & billing.</Title><Text style={s.body}>Sign in to see your membership and payments.</Text><Button label="Sign in" onPress={()=>router.navigate('/account')}/></Screen>;
  return <CustomerBilling key={auth.user.id}/>;
}

function CustomerBilling(){
  const {request}=useCustomer();
  const [billing,setBilling]=useState<Billing|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [consentedPlan,setConsentedPlan]=useState('');
  const generation=useRef(0),actionInFlight=useRef(false),active=useRef(false);
  const load=useCallback(async()=>{
    const version=++generation.current;setLoading(true);setError('');
    try{const result=await request<Billing>('/api/customer/billing');if(version===generation.current)setBilling(result);}
    catch(e){if(version===generation.current)setError((e as Error).message);}
    finally{if(version===generation.current)setLoading(false);}
  },[request]);
  useFocusEffect(useCallback(()=>{
    active.current=true;void load();
    const subscription=AppState.addEventListener('change',state=>{if(state==='active')void load();});
    return()=>{active.current=false;generation.current++;subscription.remove();};
  },[load]));
  const plan=billing?.plan;
  const planKey=plan?JSON.stringify(plan):'';
  const consent=!!planKey&&consentedPlan===planKey;
  const membership=billing?.membership;
  const hasMembership=!!membership&&!['canceled','incomplete_expired'].includes(membership.status);
  async function openCheckout(path:string){
    if(actionInFlight.current||(!consent&&path.endsWith('/checkout')))return;
    actionInFlight.current=true;setBusy(true);setError('');setNotice('');
    try{
      const result=await request<{url:string}>(path,{method:'POST',body:'{}'});
      if(!active.current)return;
      await openStripeUrl(result.url);
      if(active.current)setNotice('Return to CWASH after checkout or billing changes, then refresh. Payment is confirmed only when Stripe updates your account.');
    }catch(e){if(active.current)setError((e as Error).message);}
    finally{actionInFlight.current=false;setBusy(false);}
  }
  return <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={load}/>}>
    <Title eyebrow="YOUR CAR CARE, ALL TOGETHER" description="Manage membership payments securely with Stripe.">Membership & billing.</Title>
    <Button label="Back to account" secondary onPress={()=>router.navigate('/account')}/>
    <ErrorNotice message={error}/>{!!notice&&<Text accessibilityLiveRegion="polite" style={s.body}>{notice}</Text>}
    {loading&&!billing&&<Loading/>}
    {billing?.mode==='test'&&<View style={s.badge}><Text style={s.badgeText}>TEST MODE · NO REAL CHARGES</Text></View>}
    {billing&&!billing.enabled&&<View style={s.card}><Text style={s.cardTitle}>Online payments are coming soon.</Text><Text style={s.body}>CWASH hasn’t enabled online payments yet. You can still request an appointment.</Text></View>}
    {membership&&<View style={s.card}><Text style={s.cardTitle}>Your membership</Text><Text style={s.body}>{membershipLabel(membership.status)}</Text>{membership.currentPeriodEnd&&<Text style={s.body}>{membership.cancelAtPeriodEnd?'Ends':'Current period ends'} {new Date(membership.currentPeriodEnd*1000).toLocaleDateString('en-US',{timeZone:'America/New_York',month:'long',day:'numeric',year:'numeric'})}.</Text>}{membership.cancelAtPeriodEnd&&<Text style={s.small}>Automatic renewal is cancelled.</Text>}</View>}
    {billing?.benefits?.active&&<View style={s.card}><Text style={s.cardTitle}>Your included visits</Text><Text style={s.body}>One full detail when you join, followed by weekly maintenance. Extra services are paid separately.</Text><Text style={s.small}>Maintenance appointments must be at least seven days apart and start at least seven days after your initial full detail. Book within your current paid membership period; appointments still require confirmation.</Text>{billing.benefits.fullDetailAvailable?<Button label="Book included full detail" disabled={loading||busy} onPress={()=>router.navigate({pathname:'/book',params:{coverage:'membership',service:'full',selection:String(Date.now())}})}/>:billing.benefits.maintenanceAvailable&&<Button label="Book weekly maintenance" disabled={loading||busy} onPress={()=>router.navigate({pathname:'/book',params:{coverage:'membership',service:'maintenance',selection:String(Date.now())}})}/>}</View>}
    {billing?.enabled&&plan&&!hasMembership&&<View style={s.card}>
      <Text style={s.cardTitle}>{plan.name}</Text><Text style={s.price}>{billingAmount(plan.amount,plan.currency)} / month</Text>{!!plan.description&&<Text style={s.body}>{plan.description}</Text>}
      <Text style={s.body}>Renews automatically every month until cancelled. Review the final terms in Stripe before subscribing.</Text>
      <Pressable accessibilityRole="checkbox" accessibilityLabel="Agree to monthly membership renewal" accessibilityState={{checked:consent,disabled:busy||loading}} disabled={busy||loading} onPress={()=>setConsentedPlan(consent?'':planKey)} style={[s.card,consent&&s.selected]}><Text style={s.body}>{consent?'☑':'☐'} I agree to recurring payments of {billingAmount(plan.amount,plan.currency)} per month until I cancel.</Text></Pressable>
      <Button label={busy?'Opening Stripe…':'Continue to membership checkout'} disabled={!consent||busy||loading} onPress={()=>openCheckout('/api/customer/membership/checkout')}/>
    </View>}
    {billing?.enabled&&!plan&&!hasMembership&&<View style={s.card}><Text style={s.cardTitle}>Membership plans are coming soon.</Text><Text style={s.body}>You’ll see the price and included services here when a plan is available.</Text></View>}
    {billing?.enabled&&billing.canManage&&<><Button label={busy?'Opening Stripe…':'Manage billing'} secondary disabled={busy||loading} onPress={()=>openCheckout('/api/customer/billing/portal')}/><Text style={s.small}>Update your payment method, view invoices, or manage cancellation in Stripe.</Text></>}
    {billing?.enabled&&<Text style={s.small}>Use the included-visit buttons for membership bookings. Extra services booked through the regular booking flow are charged separately.</Text>}
    {!!billing?.payments.length&&<><Text style={s.section}>Booking payments</Text>{billing.payments.map(payment=><View key={payment.reference} style={s.card}><Text style={s.cardTitle}>{payment.reference}</Text><Text style={s.body}>{paymentLabel(payment.status)} · {billingAmount(payment.amount,payment.currency)}</Text></View>)}</>}
    <Button label={loading?'Refreshing…':'Refresh billing'} secondary disabled={loading||busy} onPress={load}/>
    <Text style={s.small}>Checkout opens in your browser. Return to the app and refresh to check the latest payment status. Card details are handled by Stripe.</Text>
  </Screen>;
}
