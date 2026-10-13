import {it,expect} from 'vitest';
import {emptyProfile,emptyStore,nextBatch} from './domain';
import {newSession} from './sessionStorage';
import {recordRound,selectResult,reviewSelection} from './history';
import {createBackup,parseBackup} from './backup';
it('review is independent of taste and removed when selection changes',()=>{const session=nextBatch(newSession(),emptyProfile());const entry=selectResult(recordRound([],session,session.snapshot!)[0],session.snapshot![0],session.roundId!);const reviewed=reviewSelection(entry,'good','만족한 선택');expect(reviewed.review?.itemId).toBe(entry.selected!.result.item.id);expect(parseBackup(createBackup({...emptyStore(),history:[reviewed]})).store.history[0].review).toEqual(reviewed.review);expect(selectResult(reviewed,session.snapshot![1],session.roundId!).review).toBeUndefined();expect(selectResult(reviewed,session.snapshot![0],session.roundId!)).toBe(reviewed);expect(reviewSelection(reviewed,undefined,'').review).toBeUndefined();expect(reviewSelection({...entry,selected:undefined},'poor','메모').review).toBeUndefined();});
