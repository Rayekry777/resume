import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Check, Download, LoaderCircle, WifiOff, RefreshCw } from 'lucide-react';

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{outcome:string}> };
export default function PwaStatus() {
 const [online,setOnline]=useState(navigator.onLine);
 const [install,setInstall]=useState<InstallEvent|null>(null);
 const [persistent,setPersistent]=useState<boolean|null>(null);
 const [cached,setCached]=useState(false);
 const {offlineReady:[ready],needRefresh:[update],updateServiceWorker}=useRegisterSW({onRegisterError:()=>console.warn('离线资源暂未准备完成，请保持网络后重新打开。')});
 useEffect(()=>{
   let mounted=true;
   if(!import.meta.env.DEV&&'serviceWorker' in navigator)void navigator.serviceWorker.ready.then(registration=>{if(mounted&&registration.active)setCached(true);}).catch(()=>{});
   const up=()=>setOnline(true),down=()=>setOnline(false);
   const offer=(event:Event)=>{event.preventDefault();setInstall(event as InstallEvent);};
   window.addEventListener('online',up);window.addEventListener('offline',down);window.addEventListener('beforeinstallprompt',offer);
   void navigator.storage?.persisted?.().then(setPersistent).catch(()=>{});
   return()=>{mounted=false;window.removeEventListener('online',up);window.removeEventListener('offline',down);window.removeEventListener('beforeinstallprompt',offer);};
 },[]);
 const status=!online?'离线模式':ready||cached?'已可离线使用':import.meta.env.DEV?'本地开发预览':'正在准备离线资源';
 const description=`${status}${persistent===true?'，已申请持久保存':''}。${ready||cached?'清理浏览器数据会移除简历和离线资源，请定期备份。':'首次使用请保持联网。'}`;
 return <div className="pwa-status" aria-live="polite">
   <span className="pwa-indicator" role="img" aria-label={description} title={description}>{!online?<WifiOff size={13}/>:ready||cached?<Check size={13}/>:<LoaderCircle size={13} className={import.meta.env.DEV?undefined:'spin'}/>}</span>
   {install&&<button type="button" title="安装到设备" onClick={async()=>{await install.prompt();await install.userChoice;setInstall(null);}}><Download size={13}/> 安装</button>}
   {update&&<button className="pwa-update" type="button" title="保存当前修改并更新" onClick={()=>window.dispatchEvent(new CustomEvent('resume:update-request',{detail:{apply:()=>updateServiceWorker(true)}}))}><RefreshCw size={13}/> 更新</button>}
 </div>;
}
