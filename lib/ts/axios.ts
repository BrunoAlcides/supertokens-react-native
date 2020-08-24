/* Copyright (c) 2020, VRAI Labs and/or its affiliates. All rights reserved.
 *
 * This software is licensed under the Apache License, Version 2.0 (the
 * "License") as published by the Apache Software Foundation.
 *
 * You may not use this file except in compliance with the License. You may
 * obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
 */
import axios, { AxiosPromise, AxiosRequestConfig, AxiosResponse } from "axios";

import FetchAuthRequest, { getDomainFromUrl, handleUnauthorised } from "./index";
import { PROCESS_STATE, ProcessState } from "./processState";
import { package_version } from "./version";
import IdRefreshToken from "./idRefreshToken";
import AntiCSRF from "./antiCsrf";

function getUrlFromConfig(config: AxiosRequestConfig) {
    let url: string = config.url === undefined ? "" : config.url;
    let baseURL: string | undefined = config.baseURL;
    if (baseURL !== undefined) {
        if (url.charAt(0) === "/" && baseURL.charAt(baseURL.length - 1) === "/") {
            url = baseURL + url.substr(1);
        } else if (url.charAt(0) !== "/" && baseURL.charAt(baseURL.length - 1) !== "/") {
            url = baseURL + "/" + url;
        } else {
            url = baseURL + url;
        }
    }
    return url;
}

export async function interceptorFunctionRequestFulfilled(config: AxiosRequestConfig) {
    let url = getUrlFromConfig(config);
    if (typeof url === "string" && getDomainFromUrl(url) !== AuthHttpRequest.apiDomain) {
        // this check means that if you are using axios via inteceptor, then we only do the refresh steps if you are calling your APIs.
        return config;
    }
    ProcessState.getInstance().addState(PROCESS_STATE.CALLING_INTERCEPTION_REQUEST);
    const preRequestIdToken = await IdRefreshToken.getToken();
    const antiCsrfToken = await AntiCSRF.getToken(preRequestIdToken);
    let configWithAntiCsrf: AxiosRequestConfig = config;
    if (antiCsrfToken !== undefined) {
        configWithAntiCsrf = {
            ...configWithAntiCsrf,
            headers:
                configWithAntiCsrf === undefined
                    ? {
                          "anti-csrf": antiCsrfToken
                      }
                    : {
                          ...configWithAntiCsrf.headers,
                          "anti-csrf": antiCsrfToken
                      }
        };
    }

    // Add package info to headers
    configWithAntiCsrf = {
        ...configWithAntiCsrf,
        headers:
            configWithAntiCsrf === undefined
                ? {
                      "supertokens-sdk-name": "react-native",
                      "supertokens-sdk-version": package_version
                  }
                : {
                      ...configWithAntiCsrf.headers,
                      "supertokens-sdk-name": "react-native",
                      "supertokens-sdk-version": package_version
                  }
    };
    return configWithAntiCsrf;
}

export function responseInterceptor(axiosInstance: any) {
    return async (response: AxiosResponse) => {
        try {
            if (!AuthHttpRequest.initCalled) {
                throw new Error("init function not called");
            }
            let url = getUrlFromConfig(response.config);
            if (typeof url === "string" && getDomainFromUrl(url) !== AuthHttpRequest.apiDomain) {
                // this check means that if you are using axios via inteceptor, then we only do the refresh steps if you are calling your APIs.
                return response;
            }
            ProcessState.getInstance().addState(PROCESS_STATE.CALLING_INTERCEPTION_RESPONSE);

            let idRefreshToken = response.headers["id-refresh-token"];
            if (idRefreshToken !== undefined) {
                await IdRefreshToken.setToken(idRefreshToken);
            }
            if (response.status === AuthHttpRequest.sessionExpiredStatusCode) {
                let config = response.config;
                return AuthHttpRequest.doRequest(
                    (config: AxiosRequestConfig) => {
                        // we create an instance since we don't want to intercept this.
                        // const instance = axios.create();
                        // return instance(config);
                        return axiosInstance(config);
                    },
                    config,
                    url,
                    response,
                    true
                );
            } else {
                let antiCsrfToken = response.headers["anti-csrf"];
                if (antiCsrfToken !== undefined) {
                    await AntiCSRF.setToken(antiCsrfToken, await IdRefreshToken.getToken());
                }
                return response;
            }
        } finally {
            if ((await IdRefreshToken.getToken()) === undefined) {
                await AntiCSRF.removeToken();
            }
        }
    };
}

/**
 * @class AuthHttpRequest
 * @description wrapper for common http methods.
 */
export default class AuthHttpRequest {
    private static refreshTokenUrl: string | undefined;
    static sessionExpiredStatusCode = 401;
    static initCalled = false;
    static apiDomain = "";
    private static refreshAPICustomHeaders: any;

    static init(options: {
        refreshTokenUrl: string;
        refreshAPICustomHeaders?: any;
        sessionExpiredStatusCode?: number;
    }) {
        let { refreshTokenUrl, refreshAPICustomHeaders, sessionExpiredStatusCode } = options;
        FetchAuthRequest.init({
            ...options,
            viaInterceptor: null
        });
        AuthHttpRequest.refreshTokenUrl = refreshTokenUrl;
        AuthHttpRequest.refreshAPICustomHeaders = refreshAPICustomHeaders === undefined ? {} : refreshAPICustomHeaders;

        if (sessionExpiredStatusCode !== undefined) {
            AuthHttpRequest.sessionExpiredStatusCode = sessionExpiredStatusCode;
        }
        AuthHttpRequest.apiDomain = getDomainFromUrl(refreshTokenUrl);
        AuthHttpRequest.initCalled = true;
    }

    /**
     * @description sends the actual http request and returns a response if successful/
     * If not successful due to session expiry reasons, it
     * attempts to call the refresh token API and if that is successful, calls this API again.
     * @throws Error
     */
    static doRequest = async (
        httpCall: (config: AxiosRequestConfig) => AxiosPromise<any>,
        config: AxiosRequestConfig,
        url?: string,
        prevResponse?: AxiosResponse,
        prevError?: any,
        viaInterceptor: boolean = false
    ): Promise<AxiosResponse<any>> => {
        if (!AuthHttpRequest.initCalled) {
            throw Error("init function not called");
        }
        if (typeof url === "string" && getDomainFromUrl(url) !== AuthHttpRequest.apiDomain && viaInterceptor) {
            if (prevError !== undefined) {
                throw prevError;
            } else if (prevResponse !== undefined) {
                return prevResponse;
            }
            // this check means that if you are using fetch via inteceptor, then we only do the refresh steps if you are calling your APIs.
            return await httpCall(config);
        }
        try {
            let throwError = false;
            let returnObj = undefined;
            while (true) {
                // we read this here so that if there is a session expiry error, then we can compare this value (that caused the error) with the value after the request is sent.
                // to avoid race conditions
                const preRequestIdToken = await IdRefreshToken.getToken();
                const antiCsrfToken = await AntiCSRF.getToken(preRequestIdToken);
                let configWithAntiCsrf: AxiosRequestConfig = config;
                if (antiCsrfToken !== undefined) {
                    configWithAntiCsrf = {
                        ...configWithAntiCsrf,
                        headers:
                            configWithAntiCsrf === undefined
                                ? {
                                      "anti-csrf": antiCsrfToken
                                  }
                                : {
                                      ...configWithAntiCsrf.headers,
                                      "anti-csrf": antiCsrfToken
                                  }
                    };
                }

                // Add package info to headers
                configWithAntiCsrf = {
                    ...configWithAntiCsrf,
                    headers:
                        configWithAntiCsrf === undefined
                            ? {
                                  "supertokens-sdk-name": "react-native",
                                  "supertokens-sdk-version": package_version
                              }
                            : {
                                  ...configWithAntiCsrf.headers,
                                  "supertokens-sdk-name": "react-native",
                                  "supertokens-sdk-version": package_version
                              }
                };
                try {
                    let localPrevError = prevError;
                    let localPrevResponse = prevResponse;
                    prevError = undefined;
                    prevResponse = undefined;
                    if (localPrevError !== undefined) {
                        throw localPrevError;
                    }
                    let response =
                        localPrevResponse === undefined ? await httpCall(configWithAntiCsrf) : localPrevResponse;
                    let idRefreshToken = response.headers["id-refresh-token"];
                    if (idRefreshToken !== undefined) {
                        await IdRefreshToken.setToken(idRefreshToken);
                    }
                    if (response.status === AuthHttpRequest.sessionExpiredStatusCode) {
                        let retry = await handleUnauthorised(
                            AuthHttpRequest.refreshTokenUrl,
                            preRequestIdToken,
                            AuthHttpRequest.refreshAPICustomHeaders,
                            AuthHttpRequest.sessionExpiredStatusCode
                        );
                        if (!retry) {
                            returnObj = response;
                            break;
                        }
                    } else {
                        let antiCsrfToken = response.headers["anti-csrf"];
                        if (antiCsrfToken !== undefined) {
                            await AntiCSRF.setToken(antiCsrfToken, await IdRefreshToken.getToken());
                        }
                        return response;
                    }
                } catch (err) {
                    if (
                        err.response !== undefined &&
                        err.response.status === AuthHttpRequest.sessionExpiredStatusCode
                    ) {
                        let retry = await handleUnauthorised(
                            AuthHttpRequest.refreshTokenUrl,
                            preRequestIdToken,
                            AuthHttpRequest.refreshAPICustomHeaders,
                            AuthHttpRequest.sessionExpiredStatusCode
                        );
                        if (!retry) {
                            throwError = true;
                            returnObj = err;
                            break;
                        }
                    } else {
                        throw err;
                    }
                }
            }
            // if it comes here, means we called break. which happens only if we have logged out.
            if (throwError) {
                throw returnObj;
            } else {
                return returnObj;
            }
        } finally {
            if ((await IdRefreshToken.getToken()) === undefined) {
                await AntiCSRF.removeToken();
            }
        }
    };

    static get = async <T = any, R = AxiosResponse<T>>(url: string, config?: AxiosRequestConfig) => {
        return await AuthHttpRequest.axios({
            method: "get",
            url,
            ...config
        });
    };

    static post = async <T = any, R = AxiosResponse<T>>(url: string, data?: any, config?: AxiosRequestConfig) => {
        return await AuthHttpRequest.axios({
            method: "post",
            url,
            data,
            ...config
        });
    };

    static delete = async <T = any, R = AxiosResponse<T>>(url: string, config?: AxiosRequestConfig) => {
        return await AuthHttpRequest.axios({
            method: "delete",
            url,
            ...config
        });
    };

    static put = async <T = any, R = AxiosResponse<T>>(url: string, data?: any, config?: AxiosRequestConfig) => {
        return await AuthHttpRequest.axios({
            method: "put",
            url,
            data,
            ...config
        });
    };

    static axios = async (anything: AxiosRequestConfig | string, maybeConfig?: AxiosRequestConfig) => {
        let config: AxiosRequestConfig = {};
        if (typeof anything === "string") {
            if (maybeConfig === undefined) {
                config = {
                    url: anything,
                    method: "get"
                };
            } else {
                config = {
                    url: anything,
                    ...maybeConfig
                };
            }
        } else {
            config = anything;
        }
        return await AuthHttpRequest.doRequest(
            (config: AxiosRequestConfig) => {
                // we create an instance since we don't want to intercept this.
                const instance = axios.create();
                return instance(config);
            },
            config,
            config.url
        );
    };

    static makeSuper = (axiosInstance: any) => {
        // we first check if this axiosInstance already has our interceptors.
        let requestInterceptors = axiosInstance.interceptors.request;
        for (let i = 0; i < requestInterceptors.handlers.length; i++) {
            if (requestInterceptors.handlers[i].fulfilled === interceptorFunctionRequestFulfilled) {
                return;
            }
        }
        // Add a request interceptor
        axiosInstance.interceptors.request.use(interceptorFunctionRequestFulfilled, async function(error: any) {
            throw error;
        });

        // Add a response interceptor
        axiosInstance.interceptors.response.use(responseInterceptor(axiosInstance), async function(error: any) {
            if (!AuthHttpRequest.initCalled) {
                throw new Error("init function not called");
            }
            try {
                if (
                    error.response !== undefined &&
                    error.response.status === AuthHttpRequest.sessionExpiredStatusCode
                ) {
                    let config = error.config;
                    return AuthHttpRequest.doRequest(
                        (config: AxiosRequestConfig) => {
                            // we create an instance since we don't want to intercept this.
                            // const instance = axios.create();
                            // return instance(config);
                            return axiosInstance(config);
                        },
                        config,
                        getUrlFromConfig(config),
                        undefined,
                        error,
                        true
                    );
                } else {
                    throw error;
                }
            } finally {
                if ((await IdRefreshToken.getToken()) === undefined) {
                    await AntiCSRF.removeToken();
                }
            }
        });
    };

    static doesSessionExist = async () => {
        return (await IdRefreshToken.getToken()) !== undefined;
    };
}
