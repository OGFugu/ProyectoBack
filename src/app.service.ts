import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  constructor(private readonly httpService: HttpService){}
  //Hacer peticiones que haría a riot
  getTest(): string {
    const username = 'Peereira7'
    const tag = 'CASTR'
    this.getpuuid(username, tag);
    return 'Hello World!';
  }
  //El return del test me tiene que devolver la información de las últimas 5 partidas
  //
  getpuuid(username, tag) {
    const puuid = this.httpService.get('https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/Peereira7/CASTR?api_key=RGAPI-5a311481-5c37-46e4-8d19-25d145a6e873');
    console.log(puuid);
    return puuid;
  }

}
