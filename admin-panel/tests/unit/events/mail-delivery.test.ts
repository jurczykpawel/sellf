/** Local access-email template acceptance for new and existing accounts. */
import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { waitForEmail } from '../../helpers/mailpit';
import { deliverMagicLink } from '@/lib/auth/magic-link/deliver';
const db=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
it('renders event date and link in the existing-account access email',async()=>{
 const email=`event-mail-${crypto.randomUUID()}@example.com`;
 const created=await db.auth.admin.createUser({email,email_confirm:true});expect(created.error).toBeNull();
 try {
  expect(await deliverMagicLink({email,redirectTo:'http://localhost:3000/auth/callback?redirect_to=%2Fmy-products',shouldCreateUser:true,data:{event_date:'10 Jan 2036',event_online_url:'https://meet.example.com/email-test'}})).toEqual({ok:true});
  const message = await waitForEmail(email);
  expect(message.HTML).toContain('10 Jan 2036');expect(message.HTML).toContain('https://meet.example.com/email-test');
  expect((await db.rpc('prepare_event_mail',{p_email:email,p_data:{}})).error).toBeNull();
  expect((await db.auth.admin.getUserById(created.data.user!.id)).data.user?.user_metadata).not.toHaveProperty('event_online_url');
 } finally {await db.auth.admin.deleteUser(created.data.user!.id);}
});
