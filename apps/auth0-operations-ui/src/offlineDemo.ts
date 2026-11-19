import type { ToolClient } from './operations.ts';

/** Fictional, local responses; never contacts an engine or an external service. */
export const demoClient: ToolClient = {
 async tool({tool}) {
  switch (tool) {
   case 'search_users': return {success:true,users:[{user_id:'auth0|demo',email:'alex@example.com'}],count:1};
   case 'get_user': return {success:true,user_id:'auth0|demo',email:'alex@example.com',blocked:false,connections:[]};
   case 'get_user_logs': return {success:true,events:[{log_id:'demo-event-1',date:'2026-01-01T12:00:00Z',type:'f',description:'Synthetic failed login'}],count:1};
   case 'get_user_blocks': return {success:true,has_blocks:false,block_count:0,blocks:[]};
   default: throw new Error('Unsupported offline demo operation.');
  }
 },
};
export const demoTarget = 'alex@example.com';
export const demoAnalysis = async () => JSON.stringify({
 takeaway: 'Synthetic example: a failed login was returned, with no account or brute-force blocks observed.',
 nextStep: 'Ask the user when the error occurred and compare it with the failed sign-in event.',
});
