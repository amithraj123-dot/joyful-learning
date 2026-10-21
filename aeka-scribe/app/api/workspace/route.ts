import {env} from 'cloudflare:workers';
import {getChatGPTUser,chatGPTSignInPath} from '../../chatgpt-auth';
import {workspaceRequest} from '../../../lib/workspace-api';
export async function POST(request:Request){const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in to save and read your notes.',signInPath:chatGPTSignInPath('/')},{status:401,headers:{'Cache-Control':'private, no-store'}});return workspaceRequest(request,env.DB,env.OPENAI_API_KEY,user.userId);}
