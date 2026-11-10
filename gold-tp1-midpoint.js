const finite = value => value !== null && value !== undefined && value !== '' &&
  typeof value !== 'boolean' && Number.isFinite(Number(value)) ? Number(value) : null;
const rounded = (value, digits=3) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

export function tp1HalfwayPrice(entry, target1) {
  const e=finite(entry),t=finite(target1);
  return e>0&&t>0&&t!==e ? rounded(e+(t-e)*0.5) : null;
}

export function halfwayTp1Reached(side, entry, target1, executableExitPrice) {
  const e=finite(entry),t=finite(target1),p=finite(executableExitPrice);
  if(!e||!t||!p||!['BUY','SELL'].includes(side))return false;
  if(side==='BUY'&&t<=e||side==='SELL'&&t>=e)return false;
  const halfway=e+(t-e)*0.5;
  return side==='BUY'?p>=halfway:p<=halfway;
}

