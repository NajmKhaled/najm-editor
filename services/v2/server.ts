import {V2Service} from './service.js';
const port=Number(process.env.NAJM_V2_PORT||47842);const service=new V2Service(port);console.log('Najm V2 direct engine listening on 127.0.0.1:'+port);
process.on('SIGINT',()=>void service.close());process.on('SIGTERM',()=>void service.close());
