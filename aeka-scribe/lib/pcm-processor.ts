// One worklet implementation is shared by the hosted and packaged renderers.
// Flush is an acknowledgement barrier so the last partial frame is not dropped.
export const pcmProcessorSource=`class FlowPCM extends AudioWorkletProcessor {
 constructor(){super();this.buffer=new Float32Array(2048);this.index=0;this.enabled=true;this.port.onmessage=e=>{if(e.data.type==='flush'){if(this.index)this.port.postMessage({samples:this.buffer.slice(0,this.index)});this.index=0;if(e.data.pause)this.enabled=false;this.port.postMessage({flushed:e.data.id});}if(e.data.type==='resume'){this.index=0;this.enabled=true;}};}
 process(inputs){const channels=inputs[0];if(this.enabled&&channels&&channels[0]){for(let i=0;i<channels[0].length;i++){let value=0;for(const c of channels)value+=c[i]||0;this.buffer[this.index++]=value/channels.length;if(this.index===this.buffer.length){this.port.postMessage({samples:this.buffer});this.buffer=new Float32Array(2048);this.index=0;}}}return true;}
} registerProcessor('flow-pcm',FlowPCM);`;
