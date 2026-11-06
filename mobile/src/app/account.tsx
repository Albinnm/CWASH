import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Customer, useCustomer } from '../lib/customer';
import { Button, ErrorNotice, Field, Loading, Screen, s, Title } from '../components/ui';

export default function Account(){
  const auth=useCustomer();
  if(auth.status==='loading')return <Screen><Title eyebrow="YOUR CWASH ACCOUNT">Opening your account…</Title><Loading/></Screen>;
  if(auth.status==='error')return <Screen><Title eyebrow="YOUR CWASH ACCOUNT">Let’s reconnect.</Title><ErrorNotice message={auth.notice}/><Button label="Retry connection" onPress={auth.retry}/></Screen>;
  return <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}>{auth.user?<Profile key={auth.user.id} user={auth.user}/>:<Authentication/>}</KeyboardAvoidingView>;
}
function Authentication(){
  const auth=useCustomer();
  const [mode,setMode]=useState<'login'|'register'>('login');
  const [form,setForm]=useState({firstName:'',lastName:'',email:'',phone:'',password:'',confirm:''});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const update=(key:keyof typeof form,value:string)=>setForm(f=>({...f,[key]:value}));
  async function submit(){
    setError('');
    if(mode==='register'&&form.password!==form.confirm){setError('Your passwords do not match.');return;}
    setBusy(true);
    try{if(mode==='login')await auth.login(form.email.trim(),form.password);else await auth.register({firstName:form.firstName,lastName:form.lastName,email:form.email.trim(),phone:form.phone,password:form.password});}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <Screen><Title eyebrow="YOUR CAR CARE, ALL TOGETHER" description="Use the same account on the website and app.">{mode==='login'?'Welcome back.':'Make yourself at home.'}</Title>{!!auth.notice&&<Text style={s.body}>{auth.notice}</Text>}<View style={s.row}><Button label="Sign in" secondary={mode!=='login'} disabled={busy} onPress={()=>{setMode('login');setError('');update('password','');update('confirm','');}}/><Button label="Create account" secondary={mode!=='register'} disabled={busy} onPress={()=>{setMode('register');setError('');update('password','');update('confirm','');}}/></View>
    {mode==='register'&&<><Field label="First name" value={form.firstName} editable={!busy} maxLength={80} autoComplete="given-name" onChangeText={v=>update('firstName',v)}/><Field label="Last name" value={form.lastName} editable={!busy} maxLength={80} autoComplete="family-name" onChangeText={v=>update('lastName',v)}/></>}
    <Field label="Email address" value={form.email} editable={!busy} maxLength={200} autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={v=>update('email',v)}/>
    {mode==='register'&&<Field label="Phone number (optional)" value={form.phone} editable={!busy} maxLength={30} autoComplete="tel" keyboardType="phone-pad" onChangeText={v=>update('phone',v)}/>}
    <Field label="Password" value={form.password} editable={!busy} secureTextEntry autoCapitalize="none" autoComplete={mode==='login'?'current-password':'new-password'} maxLength={200} onChangeText={v=>update('password',v)}/>
    {mode==='register'&&<><Text style={s.small}>Use at least 12 characters.</Text><Field label="Confirm password" value={form.confirm} editable={!busy} secureTextEntry autoCapitalize="none" autoComplete="new-password" maxLength={200} onChangeText={v=>update('confirm',v)}/></>}
    <ErrorNotice message={error}/><Button label={busy?'Please wait…':mode==='login'?'Sign in to my account':'Create my account'} disabled={busy} onPress={submit}/><Button label="Continue as guest" secondary disabled={busy} onPress={()=>router.navigate('/book')}/><Text style={s.small}>Email verification and email password recovery are not available yet. Keep your password somewhere safe.</Text>
  </Screen>;
}
function Profile({user}:{user:Customer}){
  const auth=useCustomer();
  const [form,setForm]=useState({firstName:user.firstName,lastName:user.lastName,phone:user.phone});
  const [password,setPassword]=useState({current:'',next:'',confirm:''});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function perform(action:()=>Promise<void>,message=''){
    setBusy(true);setError('');setNotice('');try{await action();setNotice(message);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  function changePassword(){if(password.next!==password.confirm){setError('Your new passwords do not match.');return;}void perform(()=>auth.changePassword(password.current,password.next));}
  return <Screen><Title eyebrow="YOUR CWASH ACCOUNT" description={user.email}>Hi, {user.firstName}.</Title><Button label="My bookings" onPress={()=>router.navigate('/bookings')}/><Button label="Membership & billing" secondary onPress={()=>router.navigate('/billing')}/><Text style={s.section}>Your profile</Text><Field label="First name" editable={!busy} value={form.firstName} maxLength={80} onChangeText={v=>setForm(f=>({...f,firstName:v}))}/><Field label="Last name" editable={!busy} value={form.lastName} maxLength={80} onChangeText={v=>setForm(f=>({...f,lastName:v}))}/><Field label="Phone number" editable={!busy} value={form.phone} maxLength={30} keyboardType="phone-pad" onChangeText={v=>setForm(f=>({...f,phone:v}))}/><Button label="Save profile" disabled={busy} secondary onPress={()=>perform(()=>auth.updateProfile(form),'Profile saved.')}/><Text style={s.section}>Change password</Text><Text style={s.small}>Use 12 or more characters. This signs you out on every device. Your email cannot be changed here.</Text><Field label="Current password" value={password.current} editable={!busy} secureTextEntry autoCapitalize="none" autoComplete="current-password" maxLength={200} onChangeText={v=>setPassword(p=>({...p,current:v}))}/><Field label="New password" value={password.next} editable={!busy} secureTextEntry autoCapitalize="none" autoComplete="new-password" maxLength={200} onChangeText={v=>setPassword(p=>({...p,next:v}))}/><Field label="Confirm new password" value={password.confirm} editable={!busy} secureTextEntry autoCapitalize="none" autoComplete="new-password" maxLength={200} onChangeText={v=>setPassword(p=>({...p,confirm:v}))}/><Button label="Change password" disabled={busy} secondary onPress={changePassword}/><ErrorNotice message={error}/>{!!notice&&<Text accessibilityLiveRegion="polite" style={s.body}>{notice}</Text>}<Button label="Sign out" disabled={busy} onPress={()=>perform(auth.logout)}/></Screen>;
}
