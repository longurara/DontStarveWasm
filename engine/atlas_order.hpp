#pragma once
#include "atlas_asset.hpp"
#include <utility>
namespace web_atlas_asset {
// Recovered from build 756039's 0x1400d8300, median selection 0x1400d7410,
// equal-pivot partition 0x1400d7590, insertion 0x1400d7a80 and heap adjust
// 0x1400d7bd0. libc++ std::sort changes equal-ID order in terrain atlases.
namespace ordering {
inline void median(std::vector<Element>& a,size_t first,size_t mid,size_t last){
    if(a[mid].id<a[first].id)std::swap(a[mid],a[first]);
    if(a[last].id<a[mid].id)std::swap(a[last],a[mid]);
    if(a[mid].id<a[first].id)std::swap(a[mid],a[first]);
}
inline std::pair<size_t,size_t> partition(std::vector<Element>& a,size_t first,size_t end){
    size_t mid=first+(end-first)/2,last=end-1;
    if(last-first>40){size_t step=(end-first)/8;
        median(a,first,first+step,first+2*step);median(a,mid-step,mid,mid+step);
        median(a,last-2*step,last-step,last);median(a,first+step,mid,last-step);
    }else median(a,first,mid,last);
    size_t pfirst=mid,plast=mid+1;
    while(first<pfirst&&a[pfirst-1].id==a[pfirst].id)--pfirst;
    while(plast<end&&a[plast].id==a[pfirst].id)++plast;
    size_t right=plast,left=pfirst;
    for(;;){
        for(;right<end;++right){
            if(a[right].id>a[pfirst].id)continue;
            if(a[right].id<a[pfirst].id)break;
            if(plast!=right)std::swap(a[plast],a[right]);++plast;
        }
        for(;left>first;--left){
            if(a[left-1].id<a[pfirst].id)continue;
            if(a[left-1].id>a[pfirst].id)break;
            --pfirst;if(pfirst!=left-1)std::swap(a[pfirst],a[left-1]);
        }
        if(left==first&&right==end)return {pfirst,plast};
        if(left==first){
            if(plast!=right&&pfirst!=plast)std::swap(a[pfirst],a[plast]);
            ++plast;if(pfirst!=right)std::swap(a[pfirst],a[right]);++pfirst;++right;
        }else if(right==end){
            --left;--pfirst;if(left!=pfirst)std::swap(a[left],a[pfirst]);
            --plast;if(pfirst!=plast)std::swap(a[pfirst],a[plast]);
        }else{--left;std::swap(a[right],a[left]);++right;}
    }
}
inline void adjust_heap(std::vector<Element>& a,size_t first,size_t hole,size_t count,Element value){
    size_t top=hole,child=2*hole+2;
    while(child<count){
        if(a[first+child].id<a[first+child-1].id)--child;
        a[first+hole]=std::move(a[first+child]);hole=child;child=2*hole+2;
    }
    if(child==count){a[first+hole]=std::move(a[first+child-1]);hole=child-1;}
    while(hole>top){size_t parent=(hole-1)/2;if(a[first+parent].id>=value.id)break;
        a[first+hole]=std::move(a[first+parent]);hole=parent;
    }
    a[first+hole]=std::move(value);
}
inline void sort(std::vector<Element>& a,size_t first,size_t end,size_t ideal){
    while(end-first>32&&ideal){
        auto pivot=partition(a,first,end);ideal=ideal/2+ideal/4;
        if(pivot.first-first<end-pivot.second){sort(a,first,pivot.first,ideal);first=pivot.second;}
        else{sort(a,pivot.second,end,ideal);end=pivot.first;}
    }
    if(end-first>32){
        size_t count=end-first;
        for(size_t i=count/2;i>0;--i){auto value=std::move(a[first+i-1]);adjust_heap(a,first,i-1,count,std::move(value));}
        while(count>1){--count;auto value=std::move(a[first+count]);a[first+count]=std::move(a[first]);adjust_heap(a,first,0,count,std::move(value));}
        return;
    }
    for(size_t i=first;i<end;++i){auto value=std::move(a[i]);size_t hole=i;
        while(hole>first&&value.id<a[hole-1].id){a[hole]=std::move(a[hole-1]);--hole;}
        a[hole]=std::move(value);
    }
}
}
}
