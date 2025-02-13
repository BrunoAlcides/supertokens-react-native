import { AxiosPromise, AxiosRequestConfig, AxiosResponse } from "axios";
export declare function interceptorFunctionRequestFulfilled(config: AxiosRequestConfig): Promise<AxiosRequestConfig<any>>;
export declare function responseInterceptor(axiosInstance: any): (response: AxiosResponse<any, any>) => Promise<AxiosResponse<any, any>>;
export declare function responseErrorInterceptor(axiosInstance: any): (error: any) => Promise<AxiosResponse<any, any>>;
/**
 * @class AuthHttpRequest
 * @description wrapper for common http methods.
 */
export default class AuthHttpRequest {
    /**
     * @description sends the actual http request and returns a response if successful/
     * If not successful due to session expiry reasons, it
     * attempts to call the refresh token API and if that is successful, calls this API again.
     * @throws Error
     */
    static doRequest: (httpCall: (config: AxiosRequestConfig<any>) => AxiosPromise<any>, config: AxiosRequestConfig<any>, url?: string | undefined, prevResponse?: AxiosResponse<any, any> | undefined, prevError?: any, viaInterceptor?: boolean) => Promise<AxiosResponse<any, any>>;
}
