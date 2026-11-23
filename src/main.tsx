import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

class ErrorBoundary extends React.Component<React.PropsWithChildren, {error:boolean}> {
  state = { error: false };
  static getDerivedStateFromError() { return {error:true}; }
  render() {
    if(this.state.error) return <main style={{maxWidth:560,margin:'15vh auto',padding:28,fontFamily:'system-ui',lineHeight:1.8}}><h1>页面遇到了一点问题</h1><p>已经保存的简历仍保留在当前浏览器中。请重新打开页面；请勿清除网站数据。</p><button onClick={()=>location.reload()}>重新打开</button></main>;
    return this.props.children;
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
