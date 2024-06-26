import { action, computed, observable, reaction } from "mobx";
import {
  AnnotationFunction,
  assert,
  createAnnotation,
  PropertyAccessor,
} from "mobx-annotation-manipulator";

import { becomeObserved } from "./becomeObserved";

interface ObserveParams<T> {
  change?: ({
    newValue,
    oldValue,
    type,
  }: {
    newValue?: T;
    oldValue?: T;
    type: "change";
  }) => void;
  enter?: ({ oldValue, type }: { oldValue?: T; type: "enter" }) => void;
  leave?: ({ oldValue, type }: { oldValue?: T; type: "leave" }) => void;
}

interface ObservAsyncParams<T, S> {
  change?: (
    {
      newValue,
      oldValue,
      type,
    }: { newValue?: T; oldValue?: T; type: "change" },
    setter: (value: S) => void
  ) => void;
  enter?: (
    { oldValue, type }: { oldValue?: T; type: "enter" },
    setter: (value: S) => void
  ) => void;
  leave?: (
    { oldValue, type }: { oldValue?: T; type: "leave" },
    setter: (value: S) => void
  ) => void;
}

const observedObject = <T>({ change, enter, leave }: ObserveParams<T>) => (
  accessor?: PropertyAccessor<T>,
  context?: any
): PropertyAccessor<T> => {
  assert(accessor?.get, "accessor doesn't have get property", accessor);
  let oldValue: T | undefined = undefined;
  return becomeObserved<T>(function(this: any) {
    enter?.call(this, { oldValue, type: "enter" });
    return () => {
      leave?.call(this, { oldValue, type: "leave" });
    };
  })(
    {
      get(): T {
        const newValue = accessor.get();
        if (oldValue !== newValue) {
          change?.call(this, { oldValue, newValue, type: "change" });
        }
        oldValue = newValue;
        return newValue;
      },
      set(value: T) {
        accessor.set?.(value);
      },
    },
    context
  );
};

const observedObjectAsync = <T, S>({
  change,
  enter,
  leave,
}: ObservAsyncParams<T, S>) => (
  accessor?: PropertyAccessor<T>,
  context?: any
): PropertyAccessor<S> => {
  assert(accessor?.get, "accessor doesn't have get property", accessor);
  const resultAccessor = observable.box(undefined as S | undefined, {
    deep: false,
  });
  return becomeObserved<S>(function(this: any) {
    const setter = action((value: S) => {
      resultAccessor.set?.(value);
    });
    const getter = () => accessor.get();
    enter?.call(this, { oldValue: getter(), type: "enter" }, setter);
    const cancelObserve = reaction(
      () => getter(),
      (newValue, oldValue) => {
        try {
          change?.call(this, { newValue, oldValue, type: "change" }, setter);
        } catch (e) {
          console.error(e);
        }
      },
      { fireImmediately: true }
    );
    return () => {
      cancelObserve();
      leave?.call(this, { oldValue: getter(), type: "leave" }, setter);
    };
  })(resultAccessor, context);
};

// MobX6 Annotations

export const observed = <T>(
  param: ObserveParams<T>
): AnnotationFunction<T, T> => {
  return createAnnotation<T, T>(observedObject<T>(param), {
    annotationType: "observed",
  });
};

const observedAsync = <T, S>(
  param: ObservAsyncParams<T, S>
): AnnotationFunction<T, S> => {
  return createAnnotation<T, S>(observedObjectAsync(param), {
    annotationType: "observed.async",
  });
};

// compound annotations

const observedObjectAsyncComputed = <T, S>({
  change,
  enter,
  leave,
}: ObservAsyncParams<T, S>) => (
  accessor?: PropertyAccessor<T>,
  context?: any
): PropertyAccessor<S> => {
  assert(accessor?.get, "accessor doesn't have get property", accessor);
  return observedObjectAsync<T, S>({
    change,
    enter,
    leave,
  })(computed(accessor.get), context);
};

observedAsync.computed = <T, S>(
  param: ObservAsyncParams<T, S>
): AnnotationFunction<T, S> => {
  return createAnnotation<T, S>(observedObjectAsyncComputed(param), {
    annotationType: "observed.async.computed",
  });
};

const observedObjectComputed = <T>(params: ObserveParams<T>) => (
  accessor?: PropertyAccessor<T>,
  context?: any
): PropertyAccessor<T> => {
  assert(accessor?.get, "accessor doesn't have get property", accessor);
  return observedObject<T>(params)(computed(accessor.get), context);
};

observed.computed = <T>(param: ObserveParams<T>): AnnotationFunction<T, T> => {
  return createAnnotation<T, T>(observedObjectComputed(param), {
    annotationType: "observed.computed",
  });
};

// derived annotations

observed.autoclose = <T>(handler: (oldValue: T) => void) => {
  const wrappedHandler = ({
    oldValue,
    newValue,
  }: {
    oldValue?: T;
    newValue?: T;
  }) => {
    if (oldValue) {
      handler(oldValue);
    }
    return newValue;
  };
  return observed.computed<T>({
    leave: wrappedHandler,
    change: wrappedHandler,
  });
};

// nested object

observed.async = observedAsync;
