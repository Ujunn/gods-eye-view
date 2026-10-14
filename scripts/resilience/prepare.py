#!/usr/bin/env python3
"""FAOSTAT 2022 complete bilateral crop CSV -> attack replay (stdlib only).

Graph conventions for this prototype:
* Undirected, unweighted topology; reverse directions aggregated as one bilateral edge.
* Static initial ranking for intentional attacks (degree, bilateral tonnage).
* Fixed initial node count is the denominator for efficiency, clustering, mean degree,
  giant-component fraction and isolation fraction; removed nodes have no connections.
* Mean path length is conditional on REACHABLE pairs and may fall on fragmentation.
* Single seeded run for random attacks, NOT a Monte Carlo confidence interval.
This reproduces the paper's attack design, not its exact data/metric implementation.
"""
from __future__ import annotations
import argparse
from collections import deque
import csv
import json
import math
from pathlib import Path
import random

ATTACKS = ('node-targeted','node-random','edge-targeted','edge-random')


def code(raw):
    s = str(raw or '').strip().lstrip("'")
    return f'{int(s):03d}' if s.isdecimal() and 0 < int(s) < 1000 else None


def build_graph(path, coords_path):
    coords = json.loads(Path(coords_path).read_text(encoding='utf-8'))
    weights = {}
    directed_weights = {}
    labels = {}
    skipped = 0
    with Path(path).open(encoding='utf-8-sig', newline='') as f:
        rows = csv.DictReader(f)
        mandatory = ['exporter_m49','importer_m49','exporter_name','importer_name','volume_tonnes']
        missing = [x for x in mandatory if x not in (rows.fieldnames or [])]
        if missing:
            raise ValueError(f'找不到完整数据的字段: {missing}; 实际字段={rows.fieldnames}')
        for row in rows:
            a,b=code(row['exporter_m49']),code(row['importer_m49'])
            if not a or not b or a == b or a not in coords or b not in coords:
                skipped+=1
                continue
            try: v=float(row['volume_tonnes'])
            except (TypeError,ValueError): v=0
            if not math.isfinite(v) or v<=0:
                skipped+=1
                continue
            labels[a]=row.get('exporter_name') or coords[a]['name']
            labels[b]=row.get('importer_name') or coords[b]['name']
            pair=tuple(sorted((a,b)))
            weights[pair]=weights.get(pair,0)+v
            directed_weights[(a,b)]=directed_weights.get((a,b),0)+v
    if len(weights)<2 or len(labels)<3:
        raise ValueError('有效双边贸易网络过小；检查是否输入了 *_full.csv（而不是筛选后的 JSON）')
    nodes = [dict(id=k,name=labels[k],iso3=coords[k]['iso3'],lat=coords[k]['lat'],lon=coords[k]['lon']) for k in sorted(labels)]
    edges = []
    for (a,b), v in weights.items():
        # Attack graph remains undirected. Arrow animation uses the dominant
        # reported export direction for this bilateral pair (not a transport route).
        ab = directed_weights.get((a,b), 0)
        ba = directed_weights.get((b,a), 0)
        source, target = (a,b) if ab >= ba else (b,a)
        edges.append(dict(id=f'{a}|{b}',source=source,target=target,
                          volumeTonnes=round(v,3),
                          dominantExportTonnes=round(max(ab,ba),3)))
    edges.sort(key=lambda e:(-e['volumeTonnes'],e['id']))
    return nodes, edges, skipped


def snapshot(node_ids, edges, removed_nodes, removed_edges, baseline_n):
    living=set(node_ids)-removed_nodes
    adjacency={n:set() for n in living}
    for edge in edges:
        if edge['id'] in removed_edges or edge['source'] not in living or edge['target'] not in living:continue
        a,b=edge['source'],edge['target']
        adjacency[a].add(b)
        adjacency[b].add(a)
    total_degrees=sum(len(v) for v in adjacency.values())
    clustering_sum=0.0
    for v,neighbors in adjacency.items():
        k=len(neighbors)
        if k<2: continue
        arr=sorted(neighbors)
        triangles=sum(1 for i,a in enumerate(arr) for b in arr[i+1:] if b in adjacency[a])
        clustering_sum+=(2*triangles)/(k*(k-1))
    # Deleted nodes are zero-degree for fixed baseline denominator.
    isolated=sum(not neighbors for neighbors in adjacency.values())+len(removed_nodes)
    visited=set()
    largest=0
    for n in adjacency:
        if n in visited:continue
        component={n}
        q=[n]
        visited.add(n)
        for u in q:
            for v in adjacency[u]:
                if v not in visited:
                    visited.add(v)
                    q.append(v)
        largest=max(largest,len(q))
    inverse_sum=0.0
    path_sum=0
    reachable_ordered=0
    for origin,links in adjacency.items():
        if not links:continue
        distances={origin:0}
        q=deque([origin])
        while q:
            cur=q.popleft()
            for dest in adjacency[cur]:
                if dest not in distances:
                    distances[dest]=distances[cur]+1
                    q.append(dest)
        for node, distance in distances.items():
            if node==origin:continue
            inverse_sum+=1/distance
            path_sum+=distance
            reachable_ordered+=1
    efficiency=inverse_sum/(baseline_n*(baseline_n-1)) if baseline_n>1 else 0.0
    def rounded(v):return round(v,7)
    return dict(clustering=rounded(clustering_sum/baseline_n),
                meanDegree=rounded(total_degrees/baseline_n),
                efficiency=rounded(efficiency),
                pathLength=rounded(path_sum/reachable_ordered) if reachable_ordered else None,
                giantFraction=rounded(largest/baseline_n),
                isolatedFraction=rounded(isolated/baseline_n),
                activeNodes=len(living), activeEdges=total_degrees//2)


def precompute(nodes,edges,seed=20261015):
    ids=[x['id'] for x in nodes]
    sorted_ids=sorted(ids)
    degree={id:0 for id in sorted_ids}
    for e in edges:
        degree[e['source']]+=1
        degree[e['target']]+=1
    node_targeted=sorted(sorted_ids,key=lambda k:(-degree[k],k))
    edge_targeted=[e['id'] for e in edges]
    node_random=sorted_ids.copy()
    edge_random=sorted(edge_targeted)
    random.Random(seed).shuffle(node_random)
    random.Random(seed+1).shuffle(edge_random)
    orders={'node-targeted':node_targeted,'node-random':node_random,
            'edge-targeted':edge_targeted,'edge-random':edge_random}
    result={}
    for kind in ATTACKS:
        order=orders[kind]
        steps=[]
        prior=None
        for pct in range(101):
            k=math.floor(len(order)*pct/100)
            deleted=set(order[:k])
            rm_nodes=deleted if kind.startswith('node-') else set()
            rm_edges=deleted if kind.startswith('edge-') else set()
            metrics=snapshot(ids,edges,rm_nodes,rm_edges,len(ids))
            if prior is None:prior=metrics['efficiency']
            metrics['efficiencyRetentionPct']=round(100*metrics['efficiency']/prior,2) if prior else 0
            steps.append(dict(percent=pct,removedCount=k,metrics=metrics))
        result[kind]=dict(order=order,steps=steps)
        print(f'  {kind}: {len(order)} 目标；0%效率 {prior:.4f}；50%保留 {steps[50]["metrics"]["efficiencyRetentionPct"]:.1f}%',flush=True)
    return result


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--input',type=Path,required=True,help='上一步提取器 output/cleaned/soybeans_full.csv')
    p.add_argument('--coords',type=Path,required=True,help='country_centroids_m49.json')
    p.add_argument('--output',type=Path,required=True,help='Gods Eye View/public/data/resilience/soybeans_2022_lab.json')
    p.add_argument('--seed',type=int,default=20261015)
    a=p.parse_args()
    nodes,edges,skipped=build_graph(a.input,a.coords)
    print(f'网络: {len(nodes)} 国家, {len(edges)} 双边关系；跳过 {skipped} 行',flush=True)
    experiments=precompute(nodes,edges,a.seed)
    result={'meta':dict(name='2022 Soybeans Resilience Lab',year=2022,crop='soybeans',
                        source='FAOSTAT Detailed Trade Matrix / 2022 / soybeans_full.csv',
                        synthetic=False,method='undirected bilateral network; static rankings; fixed original-n denominator',
                        randomSeed=a.seed,fullNetwork=True,skippedCsvRows=skipped,
                        edgeDirection='dominant-export-direction',
                        notes='Path length is average among reachable ordered pairs; no trade reallocation; intentional node degree is unweighted; bilateral weights summed from both directions; arrows use dominant observed export direction.'),
            'nodes':nodes,'edges':edges,'experiments':experiments}
    a.output.parent.mkdir(parents=True,exist_ok=True)
    tmp=a.output.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    tmp.replace(a.output)
    print(f'[OK] 生成 {a.output} ({a.output.stat().st_size/1024**2:.2f} MiB)',flush=True)

if __name__=='__main__':main()
