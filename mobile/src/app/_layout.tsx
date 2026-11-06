import { CustomerProvider } from '../lib/customer';
import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../components/ui';

export default function Layout(){return <SafeAreaProvider><CustomerProvider><StatusBar style="dark"/><Tabs screenOptions={{headerShown:false,tabBarActiveTintColor:colors.ink,tabBarInactiveTintColor:colors.muted,tabBarStyle:{backgroundColor:colors.paper},tabBarLabelStyle:{fontWeight:'700',fontSize:12}}}><Tabs.Screen name="index" options={{title:'Discover',tabBarIcon:({color})=><Text style={{color,fontSize:23}}>✦</Text>}}/><Tabs.Screen name="book" options={{title:'Book a detail',tabBarIcon:({color})=><Text style={{color,fontSize:23}}>＋</Text>}}/><Tabs.Screen name="bookings" options={{title:'My bookings',tabBarIcon:({color})=><Text style={{color,fontSize:23}}>≡</Text>}}/><Tabs.Screen name="account" options={{title:'Account',tabBarIcon:({color})=><Text style={{color,fontSize:23}}>○</Text>}}/><Tabs.Screen name="billing" options={{href:null}}/></Tabs></CustomerProvider></SafeAreaProvider>;}
