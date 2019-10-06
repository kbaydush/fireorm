// tslint:disable-next-line:no-import-side-effect
import 'reflect-metadata';

import { CollectionReference, WhereFilterOp } from '@google-cloud/firestore';

import {
  IRepository,
  FirestoreCollectionType,
  IFireOrmQueryLine,
  IOrderByParams,
  IEntity,
} from './types';

import { getMetadataStorage } from './MetadataStorage';
import { AbstractFirestoreRepository } from './AbstractFirestoreRepository';
import { TransactionRepository } from './BaseFirestoreTransactionRepository';
import { FirestoreBatchRepository } from './BatchFirestoreRepository';

export default class BaseFirestoreRepository<T extends IEntity>
  extends AbstractFirestoreRepository<T>
  implements IRepository<T> {
  private readonly firestoreColRef: CollectionReference;

  constructor(colName: string);
  constructor(colName: string, docId: string, subColName: string);

  constructor(colName: string, docId?: string, subColName?: string) {
    super(colName, docId, subColName);
    const { firestoreRef } = getMetadataStorage();

    if (!firestoreRef) {
      throw new Error('Firestore must be initialized first');
    }

    if (this.docId) {
      this.firestoreColRef = firestoreRef
        .collection(this.colName)
        .doc(this.docId)
        .collection(this.subColName);
    } else {
      this.firestoreColRef = firestoreRef.collection(this.colName);
    }
  }

  getCollectionPath() {
    return this.firestoreColRef.path;
  }

  getCollectionName() {
    return this.colName;
  }

  findById(id: string): Promise<T> {
    return this.firestoreColRef
      .doc(id)
      .get()
      .then(this.extractTFromDocSnap);
  }

  async create(item: T): Promise<T> {
    if (item.id) {
      const found = await this.findById(item.id);
      if (found) {
        return Promise.reject(
          new Error(`A document with id ${item.id} already exists.`)
        );
      }
    }

    const doc = item.id
      ? this.firestoreColRef.doc(item.id)
      : this.firestoreColRef.doc();

    if (!item.id) {
      item.id = doc.id;
    }

    await doc.set(this.toSerializableObject(item));

    if (this.collectionType === FirestoreCollectionType.collection) {
      this.initializeSubCollections(item);
    }

    return item;
  }

  async update(item: T): Promise<T> {
    // TODO: handle errors
    await this.firestoreColRef
      .doc(item.id)
      .update(this.toSerializableObject(item));
    return item;
  }

  async delete(id: string): Promise<void> {
    // TODO: handle errors
    await this.firestoreColRef.doc(id).delete();
  }

  runTransaction(executor: (tran: TransactionRepository<T>) => Promise<void>) {
    return this.firestoreColRef.firestore.runTransaction(t => {
      return executor(
        new TransactionRepository<T>(
          this.firestoreColRef,
          t,
          this.colMetadata.entity
        )
      );
    });
  }

  createBatch() {
    return new FirestoreBatchRepository(
      this.firestoreColRef,
      this.toSerializableObject
    );
  }

  async execute(
    queries: Array<IFireOrmQueryLine>,
    limitVal?: number,
    countVal?: boolean,
    offsetVal?: number,
    startAtVal?: any,
    startAfterVal?: any,
    endAtVal?: any,
    orderByObj?: IOrderByParams
  ): Promise<T[]> {
    let query = queries.reduce((acc, cur) => {
      const op = cur.operator as WhereFilterOp;
      return acc.where(cur.prop, op, cur.val);
    }, this.firestoreColRef);
    if (orderByObj) {
      query = query.orderBy(orderByObj.fieldPath, orderByObj.directionStr);
    }
    if (limitVal) {
      query = query.limit(limitVal);
    }
    if (offsetVal) {
      query = query.offset(offsetVal);
    }
    if (startAtVal) {
      query = query.startAt(startAtVal);
    }
    if (startAfterVal) {
      query = query.startAfter(startAfterVal);
    }
    if (endAtVal) {
      query = query.endAt(endAtVal);
    }
    const result = await query.get();
    if (countVal) {
      return [result.size] as any[];
    }

    return this.extractTFromColSnap(result);
  }
}
