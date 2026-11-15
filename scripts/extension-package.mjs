import {readFile,readdir} from 'node:fs/promises';
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
// A small deterministic, uncompressed ZIP needs no build-time dependency.
export async function packageExtension(){
 const local=[],directory=[];let offset=0;
 const root=new URL('../extension/',import.meta.url),files=[];
 const walk=async(prefix='')=>{for(const entry of await readdir(new URL(prefix,root),{withFileTypes:true})){
  if(entry.name.startsWith('.')||['tests','node_modules'].includes(entry.name))continue;
  const file=prefix+entry.name;if(entry.isDirectory())await walk(file+'/');else if(/\.(?:js|json|html|css|svg|png|webm|md|txt)$/.test(file))files.push(file);
 }};
 await walk();
 for(const file of files.sort()){
  const name=Buffer.from('Fantasy-Stream/'+file),data=await readFile(new URL(file,root)),crc=crc32(data);
  const head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(33,12);head.writeUInt32LE(crc,14);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(name.length,26);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(33,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);
  local.push(head,name,data);directory.push(entry,name);offset+=head.length+name.length+data.length;
 }
 const index=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(directory.length/2,8);end.writeUInt16LE(directory.length/2,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,index,end]);
}
