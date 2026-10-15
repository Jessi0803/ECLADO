import React,{useState} from 'react';
import {canAccessBackofficePage,hasBackofficePermission} from '../domain/access.js';
import InstructorRewardsPage from './InstructorRewardsPage.jsx';
import RewardWithdrawalsPage from './RewardWithdrawalsPage.jsx';
import RewardOperationsPage from './RewardOperationsPage.jsx';
import '../../components/account/InstructorRewards.css';

const tabs=[['rewards','返饋帳務'],['withdrawals','提領匯款'],['reward_notifications','通知紀錄'],['reward_reconciliation','財務對帳']];
export default function RewardManagementPage({adminUserId,access,page,onChange}){
 const [refreshVersion,setRefreshVersion]=useState(0);
 const visible=tabs.filter(([id])=>canAccessBackofficePage(access,id));
 const active=visible.find(([id])=>id===page)?.[0]||visible[0]?.[0];
 const manage=hasBackofficePermission(access,'rewards.withdrawals.manage');
 if(!active)return null;
 return <div className="reward-management">
  <div className="procurement-header"><div><h1>師資返饋管理</h1><p>管理返饋帳務、提領匯款、通知與財務對帳。</p></div><button className="admin-secondary-btn reward-management-refresh" type="button" onClick={()=>setRefreshVersion(value=>value+1)}>重新整理</button></div>
  <div className="reward-management-tabs" role="tablist" aria-label="師資返饋管理功能">
   {visible.map(([id,label])=><button type="button" role="tab" key={id} id={`reward-tab-${id}`} aria-selected={active===id} aria-controls={`reward-panel-${id}`} onClick={()=>onChange(id)}>{label}</button>)}
  </div>
  <div role="tabpanel" id={`reward-panel-${active}`} aria-labelledby={`reward-tab-${active}`}>
   {active==='rewards'&&<InstructorRewardsPage adminUserId={adminUserId} refreshVersion={refreshVersion} embedded/>}
   {active==='withdrawals'&&<RewardWithdrawalsPage adminUserId={adminUserId} canManage={manage} refreshVersion={refreshVersion} embedded/>}
   {active==='reward_notifications'&&<RewardOperationsPage key="notifications" mode="notifications" adminUserId={adminUserId} canManage={manage&&hasBackofficePermission(access,'notifications.send')} refreshVersion={refreshVersion} embedded/>}
   {active==='reward_reconciliation'&&<RewardOperationsPage key="reconciliation" mode="reconciliation" adminUserId={adminUserId} canManage={manage} refreshVersion={refreshVersion} embedded/>}
  </div>
 </div>;
}
