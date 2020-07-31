import {
  Collection as MongoCollection,
  FilterQuery,
  CollectionInsertOneOptions,
  UpdateQuery,
  UpdateWriteOpResult,
  InsertOneWriteOpResult,
  InsertWriteOpResult,
  DeleteWriteOpResultObject,
  CommonOptions,
  UpdateOneOptions,
  UpdateManyOptions,
  CollectionAggregationOptions,
  IndexSpecification,
  FindOneAndUpdateOption,
  FindAndModifyWriteOpResultObject,
  FindOneOptions,
  Cursor,
  FindOneAndDeleteOption,
} from "mongodb";
import {
  Inject,
  EventManager,
  Event,
  ContainerInstance,
  Service,
} from "@kaviar/core";
import { DatabaseService } from "../services/DatabaseService";
import { plainToClass } from "class-transformer";
import {
  BeforeInsertEvent,
  AfterInsertEvent,
  BeforeRemoveEvent,
  AfterRemoveEvent,
  BeforeUpdateEvent,
  AfterUpdateEvent,
  CollectionEvent,
} from "../events";
import { BehaviorType, IContextAware, IBundleLinkOptions } from "../defs";
import {
  query,
  ICollection,
  ILinkOptions,
  IQueryBody,
  IReducerOptions,
  IExpanderOptions,
  addReducers,
  addExpanders,
  addLinks,
  IAstToQueryOptions,
} from "@kaviar/nova";

@Service()
export abstract class Collection<T = any> implements ICollection {
  static model: any;
  static links: IBundleLinkOptions = {};
  static reducers: IReducerOptions = {};
  static expanders: IExpanderOptions = {};
  static indexes: IndexSpecification[] = [];
  static behaviors: any = [];

  static collectionName: string;

  public readonly collection: MongoCollection<T>;
  /**
   * Refers to the event manager that is only within this collection's context
   */
  public readonly localEventManager: EventManager;

  @Inject(() => EventManager)
  public readonly globalEventManager: EventManager;

  constructor(
    public readonly databaseService: DatabaseService,
    public readonly container: ContainerInstance
  ) {
    this.databaseService = databaseService;
    this.localEventManager = new EventManager();
    this.collection = databaseService.getMongoCollection(
      this.getStaticVariable("collectionName")
    );

    // Create the links, reducers, expanders
    this.initialiseNova();

    // ensure indexes
    const indexes = this.getStaticVariable("indexes");
    if (indexes.length) {
      this.collection.createIndexes(indexes);
    }

    // attach behaviors
    this.attachBehaviors();
  }

  get collectionName(): string {
    return this.collection.collectionName;
  }

  /**
   * Find data using the MongoDB classic way.
   * @param filter
   * @param options
   */
  find(filter: FilterQuery<T> = {}, options?: FindOneOptions): Cursor<T> {
    const cursor = this.collection.find(filter, options);

    const oldToArray = cursor.toArray.bind(cursor);
    cursor.toArray = async () => {
      const result = await oldToArray(...arguments);
      return this.toModel(result);
    };

    return cursor;
  }

  /**
   * FindOne
   * @param query
   * @param options
   */
  async findOne(
    query: FilterQuery<T> = {},
    options?: FindOneOptions
  ): Promise<T> {
    const result = await this.collection.findOne(query, options);

    return this.toModel(result);
  }

  async insertOne(
    document: any,
    options: IContextAware & CollectionInsertOneOptions = {}
  ): Promise<InsertOneWriteOpResult<any>> {
    const eventData = {
      document,
      context: options.context,
    };

    const event = new BeforeInsertEvent(eventData);
    await this.emit(event);

    // We will insert what is left in the event
    const result = await this.collection.insertOne(
      event.data.document,
      options
    );

    await this.emit(
      new AfterInsertEvent({
        ...eventData,
        _id: result.insertedId,
      })
    );

    return result;
  }

  async insertMany(
    documents: any[],
    options: IContextAware & CollectionInsertOneOptions = {}
  ): Promise<InsertWriteOpResult<any>> {
    const events = [];

    documents.forEach((document) => {
      events.push(
        new BeforeInsertEvent({
          document,
          context: options.context,
        })
      );
    });

    for (let event of events) {
      await this.emit(event);
    }

    const result = await this.collection.insertMany(
      events.map((e) => e.data.document),
      options
    );

    for (let i = 0; i < documents.length; i++) {
      await this.emit(
        new AfterInsertEvent({
          document: events[i].data.document,
          _id: result.insertedIds[i],
          context: options.context,
        })
      );
    }

    return result;
  }

  async updateOne(
    filters: FilterQuery<T>,
    update: UpdateQuery<T>,
    options: IContextAware & UpdateOneOptions = {}
  ): Promise<UpdateWriteOpResult> {
    const fields = this.databaseService.getFields(update);

    await this.emit(
      new BeforeUpdateEvent({
        filter: filters,
        update,
        fields,
        isMany: false,
        context: options.context,
      })
    );

    const result = await this.collection.updateOne(filters, update, options);

    await this.emit(
      new AfterUpdateEvent({
        filter: filters,
        update,
        fields,
        context: options.context,
        isMany: false,
        result,
      })
    );

    return result;
  }

  async updateMany(
    filters: FilterQuery<T>,
    update: UpdateQuery<T>,
    options: IContextAware & UpdateManyOptions = {}
  ): Promise<UpdateWriteOpResult> {
    const fields = this.databaseService.getFields(update);

    await this.emit(
      new BeforeUpdateEvent({
        filter: filters,
        update,
        fields,
        isMany: true,
        context: options.context,
      })
    );

    const result = await this.collection.updateMany(filters, update, options);

    await this.emit(
      new AfterUpdateEvent({
        filter: filters,
        update,
        fields,
        isMany: true,
        context: options.context,
        result,
      })
    );

    return result;
  }

  async deleteOne(
    filters: FilterQuery<T>,
    options: IContextAware & CommonOptions = {}
  ): Promise<DeleteWriteOpResultObject> {
    await this.emit(
      new BeforeRemoveEvent({
        filter: filters,
        isMany: false,
        context: options.context,
      })
    );

    const result = await this.collection.deleteOne(filters, options);

    await this.emit(
      new AfterRemoveEvent({
        filter: filters,
        isMany: false,
        context: options.context,
        result,
      })
    );

    return result;
  }

  /**
   * @param filters
   * @param options
   */
  async deleteMany(
    filters: FilterQuery<T>,
    options: IContextAware & CommonOptions = {}
  ): Promise<DeleteWriteOpResultObject> {
    await this.emit(
      new BeforeRemoveEvent({
        filter: filters,
        isMany: true,
        context: options.context,
      })
    );

    const result = await this.collection.deleteMany(filters, options);

    await this.emit(
      new AfterRemoveEvent({
        filter: filters,
        context: options.context,
        isMany: true,
        result,
      })
    );

    return result;
  }

  async findOneAndDelete(
    filters: FilterQuery<T> = {},
    options?: IContextAware & FindOneAndDeleteOption
  ): Promise<FindAndModifyWriteOpResultObject<T>> {
    await this.emit(
      new BeforeRemoveEvent({
        context: options?.context || {},
        filter: filters,
        isMany: false,
      })
    );

    const result = await this.collection.findOneAndDelete(filters, options);

    await this.emit(
      new AfterRemoveEvent({
        context: options?.context || {},
        filter: filters,
        isMany: false,
        result,
      })
    );

    if (result.value) {
      result.value = this.toModel(result.value);
    }

    return result;
  }

  async findOneAndUpdate(
    filters: FilterQuery<T> = {},
    update: UpdateQuery<T>,
    options: IContextAware & FindOneAndUpdateOption = {}
  ): Promise<FindAndModifyWriteOpResultObject<T>> {
    const fields = this.databaseService.getFields(update);

    await this.emit(
      new BeforeUpdateEvent({
        filter: filters,
        update,
        fields,
        isMany: false,
        context: options.context,
      })
    );

    const result = await this.collection.findOneAndUpdate(
      filters,
      update,
      options
    );

    await this.emit(
      new AfterUpdateEvent({
        filter: filters,
        update,
        fields,
        context: options.context,
        isMany: false,
        result,
      })
    );

    if (result.value) {
      result.value = this.toModel(result.value);
    }

    return result;
  }

  /**
   * @param pipeline Pipeline options from mongodb
   * @param options
   */
  aggregate(pipeline: any[], options?: CollectionAggregationOptions) {
    return this.collection.aggregate(pipeline, options);
  }

  /**
   * Queries the classes and transforms them to object of the model if it exists
   *
   * @param request
   */
  async query(request: IQueryBody): Promise<Array<Partial<T>>> {
    const results = await query(this, request).fetch();

    return this.toModel(results);
  }

  /**
   * Queries the classes and transforms them to object of the model if it exists
   *
   * @param request
   */
  async queryOne(request: IQueryBody): Promise<Partial<T>> {
    const result = await query(this, request).fetchOne();

    return this.toModel(result);
  }

  /**
   * Retrieve the collection from the database service
   * @param collectionBaseClass The collection class
   */
  getCollection(collectionBaseClass): Collection<any> {
    return this.databaseService.getCollection(collectionBaseClass);
  }

  /**
   * This helper method returns the static variable defined
   * We lose strong typing, but we avoid (this.constructor as typeof Collection)[variable] usage
   *
   * @param variable
   */
  protected getStaticVariable(variable) {
    return (this.constructor as typeof Collection)[variable];
  }

  /**
   * This runs the behavior attachment process
   */
  protected attachBehaviors() {
    const behaviors: BehaviorType[] = this.getStaticVariable("behaviors");

    behaviors.forEach((behavior) => {
      behavior(this);
    });
  }

  protected initialiseNova() {
    const links: IBundleLinkOptions = this.getStaticVariable("links") || {};
    const adaptedLinks: ILinkOptions = {};

    for (let key in links) {
      const collectionBaseClassResolver = links[key].collection;

      adaptedLinks[key] = {
        ...links[key],
        collection: () => this.getCollection(collectionBaseClassResolver()),
      };
    }

    // blend with nova links, reducers, expanders
    addLinks(this, adaptedLinks);
    addReducers(this, this.getStaticVariable("reducers") || {});
    addExpanders(this, this.getStaticVariable("expanders") || {});
  }

  /**
   * Listen to events on this collection, shorthand for localEventManager
   *
   * @param collectionEvent This is the class of the event
   * @param handler This is the function that is executed
   */
  on(collectionEvent: new () => Event, handler: any) {
    this.localEventManager.addListener(collectionEvent, handler);
  }

  /**
   * Transforms a plain object to the model
   * @param plain Object which you want to transform
   */
  toModel(plain: any) {
    const model = this.getStaticVariable("model");

    if (model) {
      return plainToClass(model, plain);
    }

    return plain;
  }

  /**
   * Perform a query directly from GraphQL resolver based on requested fields. Returns an array.
   *
   * @param ast
   * @param config
   */
  async queryGraphQL(
    ast: any,
    config?: IAstToQueryOptions
  ): Promise<Array<Partial<T>>> {
    const result = query.graphql(this, ast, config).fetch();

    return this.toModel(result);
  }

  /**
   * Perform a query directly from GraphQL resolver based on requested fields. Returns a single object.
   * @param ast
   * @param config
   */
  async queryOneGraphQL(ast, config?: IAstToQueryOptions): Promise<Partial<T>> {
    const model = this.getStaticVariable("model");
    const result = query.graphql(this, ast, config).fetchOne();

    return this.toModel(result);
  }

  /**
   * Emit events
   * @param event
   */
  async emit(event: CollectionEvent<any>) {
    event.setCollection(this);
    await this.localEventManager.emit(event);
    await this.globalEventManager.emit(event);
  }
}