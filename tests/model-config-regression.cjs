const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const M=require('../extension/homework-model.js');
const cfg={baseUrl:'https://models.example/gateway/v1',apiKey:'custom-test-key',model:'provider/free-model:latest'};
test('自定义API保留路径前缀，支持完整对话地址、末尾斜杠及本机端口',()=>{
 assert.equal(M.endpoint(cfg.baseUrl+'/chat/completions/').baseUrl,cfg.baseUrl);
 assert.equal(M.endpoint('https://models.example').modelsUrl,'https://models.example/v1/models');
 assert.equal(M.endpoint('http://localhost:11434/v1/').chatUrl,'http://localhost:11434/v1/chat/completions');
 assert.equal(M.endpoint('http://127.0.0.1:1234/v1').permission,'http://127.0.0.1/*');
 assert.equal(M.endpoint('https://models.example:8443/api/v1').permission,'https://models.example/*');
});
test('拒绝带密钥的URL、非本机HTTP及脚本协议；新模型不受固定白名单限制',()=>{
 for(const url of ['javascript:alert(1)','https://user:secret@models.example/v1','https://models.example/v1?key=secret','https://models.example/#key','http://models.example/v1',''])assert.throws(()=>M.endpoint(url));
 assert.equal(M.modelName(' provider/free-model:latest '),cfg.model);assert.equal(M.key('custom-test-key'),cfg.apiKey);
 for(const value of ['',null,'one\r\nAuthorization: other'])assert.throws(()=>M.key(value));
 assert.equal(M.configured(cfg),true);for(const key of ['baseUrl','apiKey','model'])assert.equal(M.configured({...cfg,[key]:''}),false);
});
test('模型发现只发送GET和该接口的Key，模型去重且拒绝异常项，无作业内容',async()=>{
 let request;const result=await M.listModels(cfg,{fetcher:async(url,options)=>{request={url,options};return {ok:true,json:async()=>({data:[{id:'z-chat'},{id:'a-chat'},{id:'z-chat'},null,{id:'bad\nname'},{id:3}]})};}});
 assert.deepEqual(result.models,['a-chat','z-chat']);assert.equal(request.url,cfg.baseUrl+'/models');assert.equal(request.options.method,'GET');assert.equal(request.options.headers.Authorization,'Bearer '+cfg.apiKey);assert.equal(request.options.body,undefined);assert.equal(request.options.redirect,'error');assert.equal(request.options.credentials,'omit');
});
test('模型列表支持models数组；不提供列表、无模型及非JSON时给出可操作错误，不回显响应或Key',async()=>{
 assert.deepEqual((await M.listModels(cfg,{fetcher:async()=>({ok:true,json:async()=>({models:['model-a',{id:'model-b'}]})})})).models,['model-a','model-b']);
 for(const status of [401,403,404,405,429,500])await assert.rejects(M.listModels(cfg,{fetcher:async()=>({ok:false,status,json:()=>{throw Error('never read provider error '+cfg.apiKey);}})}),e=>!e.message.includes(cfg.apiKey)&&/Key|列表|频率|HTTP/.test(e.message));
 await assert.rejects(M.listModels(cfg,{fetcher:async()=>({ok:true,json:async()=>({data:[]})})}),/没有返回/);
 await assert.rejects(M.listModels(cfg,{fetcher:async()=>({ok:true,json:async()=>{throw Error(cfg.apiKey);}})}),/有效 JSON/);
 await assert.rejects(M.listModels(cfg,{fetcher:async()=>{throw Error('refused '+cfg.apiKey);}}),e=>/无法连接/.test(e.message)&&!e.message.includes(cfg.apiKey));
});
test('获取模型支持取消超时；解题使用自定义模型，且不发送MiniMax专有参数',async()=>{
 const controller=new AbortController();controller.abort();await assert.rejects(M.listModels(cfg,{signal:controller.signal,fetcher:async()=>{throw Error('abort');}}),/超时/);
 let request;const questions=[{number:9,type:'radio',options:['A','B'],text:'文字题'}];
 const result=await M.solve(questions,cfg,{fetcher:async(url,options)=>{request={url,options};return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers:[{number:9,values:['B']}]})}}]})};}});
 assert.equal(result.model,cfg.model);assert.equal(request.url,cfg.baseUrl+'/chat/completions');const body=JSON.parse(request.options.body);assert.equal(body.model,cfg.model);assert.equal(body.reasoning_split,undefined);assert.equal(body.temperature,undefined);assert.ok(!request.options.body.includes(cfg.apiKey));
 await assert.rejects(M.solve(questions,{apiKey:cfg.apiKey},{fetcher:()=>assert.fail('未配置不能请求')}),/先配置/);
});
test('新版源码和打包清单不依赖内置Key，API域名按使用时授权',()=>{
 const dir='extension/',manifest=JSON.parse(fs.readFileSync(dir+'manifest.json','utf8'));
 assert.deepEqual(manifest.host_permissions,['https://teach.ynou.edu.cn/*']);assert.ok(manifest.optional_host_permissions.includes('https://*/*'));
 assert.doesNotMatch(fs.readFileSync(dir+'background.js','utf8'),/private-config\.js/);
 assert.doesNotMatch(fs.readFileSync(dir+'private-config.js','utf8'),/apiKey|sk-|HomeworkPrivateConfig/);
 for(const file of fs.readdirSync(dir).filter(f=>/\.(js|json|html)$/.test(f)))assert.doesNotMatch(fs.readFileSync(dir+file,'utf8'),/sk-[A-Za-z0-9_-]{20,}/,file);
});
