import test from 'node:test';
import assert from 'node:assert/strict';
import {ROLES,GLOBAL_EVENTS,FED_RULES,BOARD} from './data.js';
import {createGame,financials,assetValue,effectBreakdown,makeSnapshot,evaluateFed,rollDice,drawEvent,movementPath,endTurn,settleSeason,adjustStaff,issueLoan,repayLoan,updateBadLoans} from './engine.js';

const game=()=>createGame({players:[{name:'甲',roleId:'auto'},{name:'乙',roleId:'technology'}],seed:42});
const active=(eventId,scope='global',extra={})=>({instanceId:1,eventId,scope,ownerId:null,sector:null,startedRound:1,...extra});

test('新對局預設以建立時間作為亂數種子',()=>{
  const before=Date.now();
  const state=createGame({players:[{name:'甲',roleId:'auto'},{name:'乙',roleId:'technology'}]});
  const after=Date.now();
  assert.ok(state.seed>=before&&state.seed<=after);
  assert.equal(state.rng,state.seed|0||1);
});
test('八位玩家都完成回合後才結算，九位玩家無法開局',()=>{
  const players=ROLES.slice(0,8).map((role,i)=>({name:`玩家 ${i+1}`,roleId:role.id}));
  const state=createGame({players,seed:42});
  assert.equal(state.players.length,8);
  assert.deepEqual(state.players.map(player=>player.color),[0,1,2,3,4,5,6,7]);
  for(let i=0;i<8;i++){
    assert.equal(state.turnIndex,i);
    rollDice(state,[0,0]);
    assert.equal(state.phase,'manage');
    const result=endTurn(state);
    if(i<7){assert.equal(result,null);assert.equal(state.round,1)}
    else{assert.equal(result.finished,false);assert.equal(state.round,2);assert.equal(state.turnIndex,0)}
  }
  assert.throws(()=>createGame({players:[...players,{name:'玩家 9',roleId:ROLES[8].id}]}),/2 至 8 位玩家/);
});
test('十種企業、十張全球卡、十條規則及基準淨利符合規格',()=>{
  assert.equal(ROLES.length,10);assert.equal(GLOBAL_EVENTS.length,10);assert.equal(FED_RULES.length,10);
  assert.deepEqual(ROLES.map(r=>Math.round(Object.values(r.base).reduce((a,b)=>a+b,0))),[200,230,50,420,440,160,165,330,65,315]);
});
test('E01 依衰減向量計算，且不憑空建立銀行原物料成本',()=>{
  const s=game();s.activeEvents=[active('E01')];
  const energy=[],material=[];
  for(let k=1;k<=6;k++){s.round=k;energy.push(financials(s,'auto').flows.energy);material.push(financials(s,'auto').flows.material)}
  assert.deepEqual(energy,[-140,-130,-120,-110,-105,-100]);
  assert.deepEqual(material,[-300,-287.5,-275,-262.5,-256.25,-250]);
  assert.equal(financials(s,'bank').flows.material,0);
});
test('E05 依角色調整人力成本；全球卡同步套用所有適用企業',()=>{
  const s=game();s.activeEvents=[active('E05')];
  assert.equal(financials(s,'technology').flows.labor,-420);
  assert.equal(financials(s,'auto').flows.labor,-180);
  assert.equal(financials(s,'electronics').flows.revenue,1500);
});
test('個人、產業與全球事件同季疊加；資產從基準重估而非複利扣減',()=>{
  const s=game();s.activeEvents=[active('E02'),active('P01','personal',{instanceId:2,ownerId:'player-1'}),active('S01','sector',{instanceId:3,sector:'製造業'})];
  assert.equal(effectBreakdown(s,'auto','revenue').length,3);
  assert.equal(effectBreakdown(s,'technology','revenue').length,1);
  assert.equal(financials(s,'auto').flows.revenue,1200);
  assert.equal(assetValue(s,'auto'),520);
  s.round=2;assert.equal(assetValue(s,'auto'),576);
  s.round=7;assert.equal(assetValue(s,'auto'),800);
});
test('失業、銀行比率與缺少歷史值的快照狀態正確',()=>{
  const s=game();let snap=makeSnapshot(s);
  assert.equal(snap.unemploymentPct,5);assert.equal(snap.liquidityPct,30);assert.equal(snap.nplPct,4);
  assert.equal(snap.growthPct,null);assert.equal(snap.stockReturn3Pct,null);assert.equal(snap.loanGrowth3Pct,null);
  for(const rule of FED_RULES)for(const field of rule.fields)assert.ok(Object.hasOwn(snap,field),`${rule.id} 缺 ${field}`);
  s.phase='manage';adjustStaff(s,'player-1',-60);snap=makeSnapshot(s);assert.equal(snap.unemploymentPct,11);
  const ev=evaluateFed(snap,s).evaluations.find(x=>x.ruleId==='F05');assert.equal(ev.status,'insufficient_data');
});
test('事件成本進入通膨公式，海灣戰爭首兩季為 6.4% 與 5.3%',()=>{
  const s=game();s.activeEvents=[active('E01')];
  assert.equal(Math.round(makeSnapshot(s).inflationPct*10)/10,6.4);
  s.round=2;assert.equal(Math.round(makeSnapshot(s).inflationPct*10)/10,5.3);
});
test('借還款與壞帳操作更新銀行存量，不把借款算成淨資產',()=>{
  const s=game();s.phase='manage';const before=s.companies.auto.cash+s.companies.auto.assetReferenceValue-s.companies.auto.debt;
  issueLoan(s,'player-1',100);
  assert.equal(s.bank.totalLoans,1100);assert.equal(s.bank.liquidAssets,200);
  assert.equal(s.companies.auto.cash+s.companies.auto.assetReferenceValue-s.companies.auto.debt,before);
  repayLoan(s,'player-1',50);assert.equal(s.bank.totalLoans,1050);assert.equal(s.companies.auto.debt,50);
  const bankGame=createGame({players:[{name:'甲',roleId:'bank'},{name:'乙',roleId:'auto'}]});bankGame.phase='manage';updateBadLoans(bankGame,'player-1',50);assert.equal(bankGame.bank.nonperformingLoans,90);
});
test('聯準會缺值不觸發，F03 優先於 F01，政策下一季生效',()=>{
  const s=game();const first=makeSnapshot(s);assert.equal(evaluateFed(first,s).evaluations.find(x=>x.ruleId==='F02').status,'insufficient_data');
  const snap={...first,inflationPct:8,growthPct:-6,previousInflationPct:5};
  const {evaluations,decision}=evaluateFed(snap,s);
  assert.equal(decision.ruleId,'F03');assert.equal(decision.kind,'none');
  assert.equal(evaluations.find(x=>x.ruleId==='F01').status,'suppressed_by_priority');
  const high={...first,inflationPct:8};const d=evaluateFed(high,s).decision;assert.equal(d.kind,'rate');assert.equal(d.nextEffectiveRound,2);
  assert.equal(s.fedRatePercent,4);
});
test('F07 市場崩盤與 F10 泡沫條件分別走 QE 與升息分支',()=>{
  const s=game(),base=makeSnapshot(s);
  const crash={...base,round:2,growthPct:-2,stockReturn1Pct:-25};
  assert.equal(evaluateFed(crash,s).decision.action,'啟動 QE 2 回合');
  const bubble={...base,round:3,growthPct:2,previousGrowthPct:2,previousInflationPct:2,stockReturn1Pct:10,stockReturn3Pct:30,loanGrowth3Pct:20};
  assert.equal(evaluateFed(bubble,s).decision.action,'升息 0.25 個百分點');
  assert.equal(evaluateFed({...bubble,fedRatePct:6},s).decision.action,'啟動 QT 2 回合');
});
test('利率決策在下一季才生效，事件消失不會重設政策利率',()=>{
  const s=game();s.activeEvents=[active('E01'),active('E06','global',{instanceId:2})];
  const result=settleSeason(s);
  assert.equal(result.snapshot.fedRatePct,4);
  assert.equal(result.decision.ruleId,'F01');
  assert.equal(s.round,2);assert.equal(s.fedRatePercent,4.75);
  assert.equal(makeSnapshot(s).rateCooldownRounds,2);
  s.activeEvents=[];s.round=7;
  assert.equal(makeSnapshot(s).fedRatePct,4.75);
});
test('兩輪拉霸後才結算全市場一季',()=>{
  const s=game();assert.equal(BOARD.length,24);
  rollDice(s,[2,2]);assert.equal(s.phase,'draw');assert.equal(s.activeEvents.length,0);
  assert.throws(()=>endTurn(s));assert.throws(()=>adjustStaff(s,'player-1',1));
  assert.equal(drawEvent(s).scope,'global');assert.equal(s.phase,'manage');assert.throws(()=>drawEvent(s));
  assert.equal(endTurn(s),null);assert.equal(s.turnIndex,1);assert.equal(s.round,1);
  rollDice(s,[1,1]);drawEvent(s);const result=endTurn(s);
  assert.equal(result.snapshot.round,1);assert.equal(s.round,2);assert.equal(s.turnIndex,0);assert.equal(s.economicHistory.length,1);
});
test('棋子逐格路徑與實際落點一致，經過起點只領一次獎金',()=>{
  assert.deepEqual(movementPath(22,5),[23,0,1,2,3]);
  const s=game();s.players[0].position=22;
  const result=rollDice(s,[3,2]);
  assert.deepEqual(result.reels,[3,2]);
  assert.equal(result.dice,5);
  assert.deepEqual(result.path,[23,0,1,2,3]);
  assert.equal(s.players[0].position,3);
  assert.equal(s.companies.auto.cash,1450);
});
test('兩輪 0–6 拉霸的步數範圍為 0–12 格',()=>{
  assert.deepEqual(movementPath(5,12),[6,7,8,9,10,11,12,13,14,15,16,17]);
  const low=game();assert.equal(rollDice(low,[0,0]).dice,0);
  assert.equal(low.phase,'manage');assert.equal(low.activeEvents.length,0);
  assert.throws(()=>drawEvent(low));
  const high=game();assert.equal(rollDice(high,[6,6]).dice,12);
  assert.throws(()=>rollDice(game(),[-1,1]));
  assert.throws(()=>rollDice(game(),[7,1]));
  assert.throws(()=>rollDice(game(),[1,1,1]));
});
test('繞回起點時不顯示事件卡',()=>{
  const s=game();s.players[0].position=22;
  rollDice(s,[1,1]);
  assert.equal(s.players[0].position,0);
  assert.equal(s.phase,'manage');
  assert.equal(s.activeEvents.length,0);
  assert.throws(()=>drawEvent(s));
});
test('固定種子可重現拉霸數字與事件',()=>{
  const a=game(),b=game();
  const x=rollDice(a),y=rollDice(b);
  assert.deepEqual(x.reels,y.reels);
  assert.ok(x.reels.every(n=>n>=0&&n<=6));
  assert.equal(x.dice,y.dice);
  if(a.phase==='draw')assert.equal(drawEvent(a).eventId,drawEvent(b).eventId);
});
