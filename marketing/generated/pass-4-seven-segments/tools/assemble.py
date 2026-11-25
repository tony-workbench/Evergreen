import cv2, numpy as np, subprocess, sys
W,H=854,480; N=36
def load(p):
    c=cv2.VideoCapture(p); fs=[]
    while True:
        ok,f=c.read()
        if not ok: break
        fs.append(cv2.resize(f,(W,H),interpolation=cv2.INTER_AREA) if f.shape[:2]!=(H,W) else f)
    return fs
def est(A,B):
    ga,gb=cv2.cvtColor(A,cv2.COLOR_BGR2GRAY),cv2.cvtColor(B,cv2.COLOR_BGR2GRAY)
    s=cv2.SIFT_create(4000); ka,da=s.detectAndCompute(ga,None); kb,db=s.detectAndCompute(gb,None)
    m=cv2.BFMatcher().knnMatch(da,db,k=2); g=[x for x,y in m if x.distance<0.7*y.distance]
    pa=np.float32([ka[x.queryIdx].pt for x in g]); pb=np.float32([kb[x.trainIdx].pt for x in g])
    M,inl=cv2.estimateAffinePartial2D(pa,pb,ransacReprojThreshold=2)
    return M, int(inl.sum()), ga.mean(), gb.mean()
def part(M,w):  # fraction w of similarity M (assumes ~no rotation)
    s=np.hypot(M[0,0],M[0,1])**w
    return np.float32([[s,0,M[0,2]*w],[0,s,M[1,2]*w]])
def ease(x): return x*x*(3-2*x)
def warp(f,M): return cv2.warpAffine(f,M,(W,H),flags=cv2.INTER_LANCZOS4,borderMode=cv2.BORDER_REPLICATE)
segs=[load(f"s{i}.mp4") for i in range(1,8)]
segs[0]=segs[0][1:]                       # first frame of the push-in differs in brightness
for i in (2,4,5,6): segs[i]=segs[i][1:]    # extension segments start on a copy of the previous last frame
log=[]
for j in range(6):
    A,B=segs[j][-1],segs[j+1][0]
    M,inl,la,lb=est(A,B); sc=np.hypot(M[0,0],M[0,1]); log.append((j+1,j+2,round(float(sc),3),round(float(M[0,2]),1),round(float(M[1,2]),1),inl,round(la,1),round(lb,1)))
    if sc>=1.004:      # next segment is tighter: ease the tail of this one into its framing
        n=min(N,len(segs[j]))
        for k in range(n):
            w=ease((k+1)/n); idx=len(segs[j])-n+k
            segs[j][idx]=warp(segs[j][idx],part(M,w))
    elif sc<=0.996:    # next segment is wider: start it in this framing and ease out
        Mi=cv2.invertAffineTransform(M); n=min(N,len(segs[j+1]))
        for k in range(n):
            w=1-ease(k/n); segs[j+1][k]=warp(segs[j+1][k],part(Mi,w))
    # brightness: ramp the head of the next segment from the previous level to its own
    A2,B2=segs[j][-1],segs[j+1][0]
    g=cv2.cvtColor(A2,cv2.COLOR_BGR2GRAY).mean()/max(1,cv2.cvtColor(B2,cv2.COLOR_BGR2GRAY).mean())
    n=min(N,len(segs[j+1]))
    for k in range(n):
        gg=1+(g-1)*(1-ease(k/n)); segs[j+1][k]=np.clip(segs[j+1][k].astype(np.float32)*gg,0,255).astype(np.uint8)
for l in log: print("join",l)
t=0
for i,s in enumerate(segs): print("seg",i+1,"starts %.2fs"%(t/24),"frames",len(s)); t+=len(s)
print("total %.2fs"%(t/24))
allf=[f for s in segs for f in s]
starts=np.cumsum([0]+[len(s) for s in segs])
def smooth(j,half=4):  # short dissolve across frame j-1 | j, where the picture is re-rendered
    pre=[allf[min(k,j-1)].astype(np.float32) for k in range(j-half,j+half)]
    post=[allf[max(k,j)].astype(np.float32) for k in range(j-half,j+half)]
    for i,k in enumerate(range(j-half,j+half)):
        w=ease((i+1)/(2*half+1)); allf[k]=np.clip(pre[i]*(1-w)+post[i]*w,0,255).astype(np.uint8)
for j in (int(starts[3]),int(starts[5]),int(starts[6]),int(starts[4])+123): smooth(j); print("smoothed at",j)
p=subprocess.Popen(["ffmpeg","-v","error","-y","-f","rawvideo","-pix_fmt","bgr24","-s",f"{W}x{H}","-r","24","-i","-","-an","-c:v","libx264","-crf","14","-pix_fmt","yuv420p",sys.argv[1]],stdin=subprocess.PIPE)
for f in allf: p.stdin.write(f.tobytes())
p.stdin.close(); p.wait()
