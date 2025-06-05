// Cloud Function: generateReportPdf (pagination + full sections)
// • KPI cards (labels + values)
// • Executive Summary (7 columns)
// • Consumer Feedback call‑outs
// • Photo Gallery grid
// • NEW: Detailed Results table
// • Simple pagination: whenever we need more vertical space, start a new page.

import { onRequest } from "firebase-functions/v2/https";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fetch from "node-fetch";
import dayjs from "dayjs";

/********************
 * Helper functions *
 *******************/
const stripHtml = (html?: string | null): string => {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>/gi, "\n\n")
    .replace(/<\/p>/gi, "")
    .replace(/<ul[^>]*>/gi, "")
    .replace(/<\/ul>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
};

async function fetchBytes(url?: string | null): Promise<Uint8Array | null> {
  if (!url) return null;
  if (url.startsWith("data:")) return Uint8Array.from(Buffer.from(url.split(",",2)[1]??"","base64"));
  try { const r = await fetch(url,{timeout:15000}); if(!r.ok) return null; return Uint8Array.from(await r.buffer()); } catch { return null; }
}

const fmtDate=(ds?:{date?:string}|null)=>{ if(!ds?.date) return dayjs().format("MMM D, YYYY"); const [m,d,y0]=ds.date.split("/").map(Number); if([m,d,y0].some(isNaN)) return ds.date; const y=y0<100?y0+2000:y0; return dayjs(new Date(y,m-1,d)).format("MMM D, YYYY"); };

function drawTxt(pg:any,t:string,x:number,y:number,f:any,s:number,c:any,opts:any={}){ pg.drawText(t,{x,y,font:f,size:s,color:c,...opts}); }

/****************
 * Main handler *
 ****************/
export const generateReportPdf = onRequest({ cors:true, maxInstances:10 }, async (req:Request,res:Response):Promise<void> => {
  if(req.method!=="POST"){ res.status(405).send("POST only"); return; }
  const data=(req.body?.reportJsonParam??req.body) as any;
  if(!data){ res.status(400).send("Missing reportJsonParam"); return; }

  try{
    const pdf=await PDFDocument.create();
    const fontR=await pdf.embedFont(StandardFonts.Helvetica);
    const fontB=await pdf.embedFont(StandardFonts.HelveticaBold);

    const colors={orange:rgb(0.96,0.51,0.12), orange2:rgb(0.9,0.62,0.35), white:rgb(1,1,1), black:rgb(0,0,0), grey:rgb(0.35,0.35,0.35), lightGrey:rgb(0.9,0.9,0.9)};

    let page=pdf.addPage([842,595]);
    const {width:W,height:H}=page.getSize();
    let y=H-40; // cursor below header later

    const newPage=()=>{ page=pdf.addPage([842,595]); y=H-40; drawHeader(); };
    const ensureSpace=(needed:number)=>{ if(y-needed<60){ newPage(); }};

    /** Header draws on current page */
    const drawHeader=()=>{
      page.drawRectangle({x:0,y:H-90,width:W,height:90,color:colors.orange});
      drawTxt(page,data.report?.reportName??"Tasting Report",40,H-55,fontB,26,colors.white);
      drawTxt(page,`Prepared for: ${data.report?.client?.[0]?.identifier??"Client"}`,40,H-75,fontR,14,colors.white);
      drawTxt(page,`Date: ${fmtDate(data.report?.reportDate)}`,40,H-90,fontR,12,colors.white);
      if(data.report?.logoUrl){ fetchBytes(data.report.logoUrl).then(b=>{ if(!b) return; pdf.embedPng(b).catch(()=>null).then(img=>{ if(!img) return; page.drawImage(img,{x:W-120,y:H-85,width:80,height:70});});}); }
    };

    drawHeader();
    y=H-130;

    /** KPI cards */
    const cardW=(W-80)/3; const drawKpi=(title:string,val:string,col:number,row:number)=>{ const x=40+col*(cardW+10); const y0=y-row*65; page.drawRectangle({x,y:y0-55,width:cardW,height:55,color:colors.lightGrey,borderColor:rgb(0.8,0.8,0.8),borderWidth:0.5}); drawTxt(page,title,x+8,y0-20,fontR,8,colors.grey); drawTxt(page,val,x+8,y0-38,fontB,16,colors.black); };
    drawKpi("Total Tastings",String(data.report?.count??0),0,0);
    drawKpi("Total Sampled",String(data.report?.sampledAuto??0),1,0);
    drawKpi("Total Sold",String(data.report?.totalSalesAuto??0),2,0);
    drawKpi("Avg Sampled",String(data.report?.averageSampled??0),0,1);
    drawKpi("Avg Sold",String(data.report?.averageSales??0),1,1);
    drawKpi("Conversion Rate",`${data.report?.conversion??0}%`,2,1);
    y-=65*2+20;

    /** Executive Summary */
    ensureSpace(100);
    drawTxt(page,"Executive Summary",40,y,fontB,12,colors.black); y-=15;
    const exHeaders=["Brand/Region","#Tastings","Total Samp.","Avg Samp.","Total Sold","Avg Sold","Conv.%"]; const exW=[150,60,70,70,60,60,60];
    let x=40; exHeaders.forEach((h,i)=>{page.drawRectangle({x,y:y-16,width:exW[i],height:16,color:colors.lightGrey}); drawTxt(page,h,x+2,y-4,fontB,7,colors.black); x+=exW[i];}); y-=16;
    for(const row of (data.executiveSummary??[])){
      ensureSpace(14);
      x=40; const conv=typeof row.conversionPercent==='number'?(row.conversionPercent*100).toFixed(1)+'%':'-'; const cells=[row.conditionalName,row.tastingsCount,row.totalSampled,row.averageSampled,row.totalSold,row.averageSold,conv]; cells.forEach((c,i)=>{ drawTxt(page,String(c??'-'),x+2,y-12,fontR,7,colors.black); x+=exW[i]; }); y-=14;
    }
    y-=20;

    /** Consumer Feedback */
    if(Array.isArray(data.comments)&&data.comments.length){ ensureSpace(60); drawTxt(page,"Consumer Feedback",40,y,fontB,12,colors.black); y-=14; for(const c of data.comments){ if(!c.comment) continue; ensureSpace(50); page.drawRectangle({x:40,y:y-40,width:W-80,height:40,color:rgb(0.96,0.96,0.96),borderColor:colors.orange2,borderWidth:1}); drawTxt(page,stripHtml(c.comment),46,y-20,fontR,8,colors.black,{maxWidth:W-92,lineHeight:10}); y-=45; }}

    /** Photo Gallery */
    if(Array.isArray(data.photos)&&data.photos.length){ ensureSpace(120); drawTxt(page,"Photo Gallery",40,y,fontB,12,colors.black); y-=14; let col=0,rowTop=y; for(const p of data.photos){ const bytes=await fetchBytes(p.image?.url); if(bytes){ const img=await (pdf.embedJpg(bytes).catch(()=>null)||pdf.embedPng(bytes).catch(()=>null)); if(img) page.drawImage(img,{x:40+col*100,y:rowTop-90,width:90,height:90}); } col++; if(col===4){ col=0; rowTop-=100; ensureSpace(100); } if(rowTop<100){ ensureSpace(100); rowTop=y; } } y=rowTop-100; }

    /** Detailed Results */
    if(Array.isArray(data.tastings)&&data.tastings.length){ ensureSpace(100); drawTxt(page,"Detailed Results",40,y,fontB,12,colors.black); y-=14; const hdr=["#","Store","Date","Time","City","Sampled","Sold","Conv.%"]; const w=[20,100,60,40,80,50,40,40]; x=40; hdr.forEach((h,i)=>{ page.drawRectangle({x,y:y-14,width:w[i],height:14,color:colors.lightGrey}); drawTxt(page,h,x+2,y-4,fontB,6,colors.black); x+=w[i]; }); y-=14; for(const t of data.tastings){ ensureSpace(12); x=40; const cells=[t.tastingNumber,t.store,fmtDate(t.scheduledDate),t.scheduledTime,t.city,t.totalConsumersSampledR,t.totalSales, (typeof t.conversion==='number'?(t.conversion*100).toFixed(1)+'%':'-')]; cells.forEach((c,i)=>{ drawTxt(page,String(c??'-'),x+2,y-10,fontR,6,colors.black); x+=w[i]; }); y-=12; }
    }

        const bytes = await pdf.save();

    // Cloud Functions response limit is 10 MB. If we exceed ~9 MB, write to Cloud Storage and return a signed URL instead.
    if (bytes.length > 9_000_000) {
      const { Storage } = await import("@google-cloud/storage");
      const storage = new Storage();
      const bucketName = process.env.PDF_OUTPUT_BUCKET || `${process.env.GCP_PROJECT}-pdf-cache`;
      const bucket = storage.bucket(bucketName);
      // Ensure bucket exists (no‑op if it already does)
      try { await bucket.exists().then(([e]) => !e && bucket.create()); } catch {}
      const fileName = `reports/report_${Date.now()}.pdf`;
      const file = bucket.file(fileName);
      await file.save(Buffer.from(bytes), { contentType: "application/pdf", resumable: false, private: true });
      const [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + 1000 * 60 * 60 }); // 1 hr
      res.status(200).json({ downloadUrl: url, note: "PDF was larger than 9 MB so a signed URL was returned instead of inline bytes." });
      return;
    }

    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename=report_${Date.now()}.pdf` });
    res.status(200).send(Buffer.from(bytes));(200).send(Buffer.from(bytes));
  }catch(e){ console.error("PDF generation error",e); res.status(500).send("Error generating PDF"); }
});
