import * as Linking from 'expo-linking';

export type Payment = {reference:string;status:'pending'|'paid'|'refunded'|'partially_refunded';amount:number;currency:string};
export type Billing = {
  enabled:boolean;
  mode:'test'|'live'|null;
  plan:null|{name:string;description:string;amount:number;currency:'usd';interval:'month'};
  membership:null|{status:string;cancelAtPeriodEnd:boolean;currentPeriodEnd:number|null};
  canManage:boolean;
  benefits?:{active:boolean;fullDetailAvailable:boolean;maintenanceAvailable?:boolean;periodEnd:number|null};
  payments:Payment[];
};

export function safeStripeUrl(value:string):string {
  let url:URL;
  try{url=new URL(value);}catch{throw new Error('The payment link is invalid. Please refresh and try again.');}
  if(url.protocol!=='https:'||!['checkout.stripe.com','billing.stripe.com'].includes(url.hostname)||url.username||url.password||(url.port&&url.port!=='443')){
    throw new Error('The payment link is not a trusted Stripe address. Please try again.');
  }
  return url.toString();
}
export async function openStripeUrl(value:string){await Linking.openURL(safeStripeUrl(value));}
export const billingAmount=(cents:number,currency='usd')=>new Intl.NumberFormat('en-US',{style:'currency',currency:currency.toUpperCase()}).format(cents/100);
export const membershipLabel=(status:string)=>({active:'Active',trialing:'Trial',past_due:'Payment overdue',unpaid:'Payment required',incomplete:'Awaiting payment',incomplete_expired:'Checkout expired',canceled:'Cancelled',paused:'Paused'}[status]||'Updating membership');
export const paymentLabel=(status:Payment['status'])=>({pending:'Payment not confirmed',paid:'Paid',refunded:'Refunded',partially_refunded:'Partially refunded'}[status]);
