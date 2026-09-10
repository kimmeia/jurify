// OKLCH -> sRGB hex (D65), para traduzir os tokens reais do index.css pro mockup
function f(x){return x<=0.0031308?12.92*x:1.055*Math.pow(x,1/2.4)-0.055}
function oklch(L,C,Hdeg){
  const h=Hdeg*Math.PI/180, a=C*Math.cos(h), b=C*Math.sin(h);
  const l_=L+0.3963377774*a+0.2158037573*b;
  const m_=L-0.1055613458*a-0.0638541728*b;
  const s_=L-0.0894841775*a-1.2914855480*b;
  const l=l_**3,m=m_**3,s=s_**3;
  let R= 4.0767416621*l -3.3077115913*m +0.2309699292*s;
  let G=-1.2684380046*l +2.6097574011*m -0.3413193965*s;
  let B=-0.0041960863*l -0.7034186147*m +1.7076147010*s;
  return '#'+[R,G,B].map(v=>{v=f(v);v=Math.max(0,Math.min(1,v));return Math.round(v*255).toString(16).padStart(2,'0')}).join('');
}
const T={
 'primary (navy)':[0.413,0.112,255],
 'background':[0.972,0.003,248],
 'foreground/tinta':[0.240,0.027,253],
 'secondary/muted':[0.957,0.005,248],
 'muted-foreground':[0.520,0.035,250],
 'accent-bg':[0.955,0.012,248],
 'border':[0.917,0.010,253],
 'sidebar':[0.240,0.027,253],
 'sidebar-foreground':[0.847,0.018,248],
 'sidebar-accent':[0.335,0.048,253],
 'sidebar-primary':[0.707,0.100,250],
 'secondary-foreground':[0.366,0.031,252],
 'neutral':[0.582,0.030,247],
 'warning':[0.508,0.105,72],
 'warning-bg':[0.975,0.021,86],
 'success':[0.487,0.113,157],
 'success-bg':[0.962,0.017,163],
 'danger':[0.478,0.170,29],
 'danger-bg':[0.965,0.014,23],
 'hero':[0.413,0.112,255],
 'hero-2':[0.318,0.084,256],
 'marca (logo)':[0.541,0.281,293],
 'marca-em-escuro':[0.702,0.183,293],
};
for(const[k,v]of Object.entries(T))console.log(oklch(...v),k);
