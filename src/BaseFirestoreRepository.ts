// tslint:disable-next-line:no-import-side-effect
import 'reflect-metadata';
import { plainToClass } from 'class-transformer';

import {
  IRepository,
  IFirestoreVal,
  IQueryBuilder,
  FirestoreCollectionType,
  IFireOrmQueryLine,
  IQueryExecutor,
  IEntity,
} from './types';

import {
  DocumentSnapshot,
  CollectionReference,
  WhereFilterOp,
  QuerySnapshot,
} from '@google-cloud/firestore';

import QueryBuilder from './QueryBuilder';
import { getMetadataStorage } from './MetadataStorage';
import { GetRepository } from './helpers';

export default class BaseFirestoreRepository<T extends IEntity>
  implements IRepository<T>, IQueryBuilder<T>, IQueryExecutor<T> {
  public collectionType: FirestoreCollectionType;
  private firestoreCollection: CollectionReference;

  constructor(colName: string);
  constructor(colName: string, docId: string, subColName: string);

  constructor(
    protected colName: string,
    protected docId?: string,
    protected subColName?: string
  ) {
    const { firestoreRef } = getMetadataStorage();

    if (!firestoreRef) {
      throw new Error('Firestore must be initialized first');
    }

    if (this.docId) {
      this.collectionType = FirestoreCollectionType.subcollection;
      this.firestoreCollection = firestoreRef
        .collection(this.colName)
        .doc(this.docId)
        .collection(this.subColName);
    } else {
      this.collectionType = FirestoreCollectionType.collection;
      this.firestoreCollection = firestoreRef.collection(this.colName);
    }
  }

  private extractTFromDocSnap = (doc: DocumentSnapshot): T => {
    // TODO: documents with only subcollections will return null, validate
    if (!doc.exists) {
      return null;
    }

    const collection = getMetadataStorage().collections.find(
      c => c.name === this.colName
    );

    if (!collection) {
      throw new Error(`There is no collection called ${this.colName}`);
    }

    /*
      Here we're casting to any because plainToClass returns a type
      that cannot be implicitly casted to T, might revisit later.
    */
    // tslint:disable-next-line:no-unnecessary-type-assertion
    const entity = plainToClass(
      collection.entity as any,
      this.parseTimestamp(doc.data() as T)
    ) as any;

    /*
      If we're retreiving a Collection, we have to check if we have
      subcollections registered. If so, set the repositories.
    */
    if (this.collectionType === FirestoreCollectionType.collection) {
      const subcollections = getMetadataStorage().subCollections.filter(
        sc => sc.parentEntity === collection.entity
      );

      subcollections.forEach(subCol => {
        Object.assign(entity, {
          [subCol.name]: GetRepository(
            subCol.entity as any,
            doc.id,
            subCol.name
          ),
        });
      });
    }

    return entity;
  };

  private extractTFromColSnap = (q: QuerySnapshot): T[] => {
    return q.docs.map(this.extractTFromDocSnap);
  };

  private parseTimestamp = (obj: T): T => {
    Object.keys(obj).forEach(key => {
      if (!obj[key]) return;
      if (typeof obj[key] === 'object' && 'toDate' in obj[key]) {
        obj[key] = obj[key].toDate();
      } else if (typeof obj[key] === 'object') {
        this.parseTimestamp(obj[key]);
      }
    });

    return obj;
  };

  // TODO: have a smarter way to do this
  private toObject = (obj: T): Object => {
    return { ...obj };
  };

  findById(id: string): Promise<T> {
    return this.firestoreCollection
      .doc(id)
      .get()
      .then(this.extractTFromDocSnap);
  }

  async create(item: T): Promise<T> {
    if (item.id) {
      const found = await this.findById(item.id);
      if (found) {
        return Promise.reject(
          new Error('Trying to create an already existing document')
        );
      }
    }

    const doc = item.id
      ? this.firestoreCollection.doc(item.id)
      : this.firestoreCollection.doc();

    await doc.set(this.toObject(item));

    item.id = doc.id;

    return item;
  }

  async update(item: T): Promise<T> {
    // TODO: handle errors
    await this.firestoreCollection.doc(item.id).update(this.toObject(item));
    return item;
  }

  async delete(id: string): Promise<void> {
    // TODO: handle errors
    await this.firestoreCollection.doc(id).delete();
  }

  limit(limitVal: number): QueryBuilder<T> {
    return new QueryBuilder<T>(this).limit(limitVal);;
  }

  find(): Promise<T[]> {
    return new QueryBuilder<T>(this).find();
  }

  execute(queries: Array<IFireOrmQueryLine>, limitVal?: number): Promise<T[]> {
    let query = queries
      .reduce((acc, cur) => {
        const op = cur.operator as WhereFilterOp;
        return acc.where(cur.prop, op, cur.val);
      }, this.firestoreCollection);
      if (limitVal) {
        query = query.limit(limitVal)
      }
      return query.get()
        .then(this.extractTFromColSnap);
  }

  whereEqualTo(prop: keyof T, val: IFirestoreVal): QueryBuilder<T> {
    return new QueryBuilder<T>(this).whereEqualTo(prop, val);
  }

  whereGreaterThan(prop: keyof T, val: IFirestoreVal): QueryBuilder<T> {
    return new QueryBuilder<T>(this).whereGreaterThan(prop, val);
  }

  whereGreaterOrEqualThan(prop: keyof T, val: IFirestoreVal): QueryBuilder<T> {
    return new QueryBuilder<T>(this).whereGreaterOrEqualThan(prop, val);
  }

  whereLessThan(prop: keyof T, val: IFirestoreVal): QueryBuilder<T> {
    return new QueryBuilder<T>(this).whereLessThan(prop, val);
  }

  whereLessOrEqualThan(prop: keyof T, val: IFirestoreVal): QueryBuilder<T> {
    return new QueryBuilder<T>(this).whereLessOrEqualThan(prop, val);
  }

  whereArrayContains(prop: keyof T, val: IFirestoreVal): QueryBuilder<T> {
    return new QueryBuilder<T>(this).whereArrayContains(prop, val);
  }

  filterBySubtring(prop: string, val: string): Promise<T[]> {
    return this.firestoreCollection
      .orderBy(prop)
      .startAt(val.toLowerCase())
      .endAt(val.toLowerCase() + "\uf8ff")
      .get()
      .then(this.extractTFromColSnap);
  }
}


// await db.collection('restaurants').orderBy("lowName")
//   .startAt(this.search.toLowerCase()).endAt(this.search.toLowerCase() + "\uf8ff").get()
//   .then(snapshot => {
//     snapshot.docs.forEach(doc => {
//
//       let item = doc.data()
//       item.id = doc.id
//       this.desserts.push(item);
//     })
//   })
//   // .catch(err => console.log(err.response.data))
//   .finally(() => this.loading = false);