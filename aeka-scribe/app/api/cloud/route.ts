import {env} from 'cloudflare:workers';
import {getChatGPTUser,chatGPTSignInPath} from '../../chatgpt-auth';
import {cloudRequest} from '../../../lib/cloud-api';
export async function POST(request:Request){const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in to your hosted workspace.',signInPath:chatGPTSignInPath('/')},{status:401,headers:{'Cache-Control':'private, no-store'}});return cloudRequest(request,env.DB,{userId:user.userId,email:user.email||''});}
